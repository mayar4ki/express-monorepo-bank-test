import net from 'node:net';

import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';

import { createKafka } from './client.js';

/**
 * The same broker image the compose stack runs, so tests and production agree.
 * `@testcontainers/kafka` is not used because it only drives Confluent Platform
 * images and rejects apache/kafka tags outright.
 */
const KAFKA_IMAGE = 'apache/kafka:3.9.1';
const BROKER_PORT = 9092;
const CONTROLLER_PORT = 9093;

export interface TestKafka {
  brokers: string[];
  stop: () => Promise<void>;
}

/** Asks the OS for a free port and releases it again. */
async function reserveHostPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('could not reserve a port'))));
    });
  });
}

/** The port is only listening once metadata requests actually succeed. */
async function waitForBroker(brokers: string[], attempts = 30): Promise<void> {
  const admin = createKafka({ brokers, clientId: 'test-readiness' }).admin();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await admin.connect();
      await admin.listTopics();
      await admin.disconnect();
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

/**
 * Starts a disposable single-node Kafka in KRaft mode (or reuses
 * TEST_KAFKA_BROKERS if set), mirroring `startRedisForTests` in `@bank/queue`.
 *
 * The broker port is bound to a known host port rather than a random one:
 * Kafka hands clients the address in its advertised listener and they reconnect
 * to it, so that address has to be reachable from outside the container and has
 * to be known before the broker starts.
 */
export async function startKafkaForTests(): Promise<TestKafka> {
  const fromEnv = process.env.TEST_KAFKA_BROKERS;
  if (fromEnv) {
    const brokers = fromEnv.split(',').map((broker) => broker.trim());
    await waitForBroker(brokers);
    return { brokers, stop: async () => {} };
  }

  const hostPort = await reserveHostPort();
  const container: StartedTestContainer = await new GenericContainer(KAFKA_IMAGE)
    .withExposedPorts({ container: BROKER_PORT, host: hostPort })
    .withEnvironment({
      KAFKA_NODE_ID: '1',
      KAFKA_PROCESS_ROLES: 'broker,controller',
      KAFKA_CONTROLLER_QUORUM_VOTERS: `1@localhost:${CONTROLLER_PORT}`,
      KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER',
      KAFKA_LISTENERS: `PLAINTEXT://0.0.0.0:${BROKER_PORT},CONTROLLER://0.0.0.0:${CONTROLLER_PORT}`,
      KAFKA_ADVERTISED_LISTENERS: `PLAINTEXT://127.0.0.1:${hostPort}`,
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: 'CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT',
      KAFKA_INTER_BROKER_LISTENER_NAME: 'PLAINTEXT',
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: '1',
      // Required for the idempotent producer on a single-node broker.
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: '1',
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: '1',
      // Do not make every test wait out the default rebalance delay.
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: '0',
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: 'false',
    })
    .withWaitStrategy(Wait.forLogMessage(/Kafka Server started/))
    .withStartupTimeout(180_000)
    .start();

  const brokers = [`127.0.0.1:${hostPort}`];
  await waitForBroker(brokers);

  return {
    brokers,
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * Creates topics up front. Production disables auto-creation so partition
 * counts are deliberate; tests do the same so they exercise the real setup.
 */
export async function createTestTopics(
  brokers: string[],
  topics: string[],
  options: { partitions?: number } = {},
): Promise<void> {
  const admin = createKafka({ brokers, clientId: 'test-admin' }).admin();
  await admin.connect();
  try {
    await admin.createTopics({
      waitForLeaders: true,
      topics: topics.map((topic) => ({ topic, numPartitions: options.partitions ?? 1 })),
    });
  } finally {
    await admin.disconnect();
  }
}
