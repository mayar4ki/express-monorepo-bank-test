import { defineRoute } from '@bank/shared';
import { errorEnvelope } from '@bank/shared';
import { toTransferDto } from '@bank/shared';
import type { TransferService } from './service.js';
import {
  createTransferBody,
  idempotencyHeaders,
  transferParams,
  transferResponse,
} from './schemas.js';

export function transferRoutes(service: TransferService) {
  return [
    defineRoute({
      method: 'post',
      path: '/transfers',
      summary: 'Submit a transfer between two accounts (asynchronous)',
      tags: ['Transfers'],
      request: { body: createTransferBody, headers: idempotencyHeaders },
      responses: {
        202: {
          description:
            'Transfer accepted and queued; poll GET /transfers/{id} (Location header) for the outcome',
          schema: transferResponse,
        },
        200: {
          description: 'Idempotent replay: current state of the previously submitted transfer',
          schema: transferResponse,
        },
        400: { description: 'Validation error / missing Idempotency-Key', schema: errorEnvelope },
        404: { description: 'Source or destination account not found', schema: errorEnvelope },
        409: {
          description: 'Idempotency-Key already used with a different payload',
          schema: errorEnvelope,
        },
        422: { description: 'Rejected synchronously: SAME_ACCOUNT', schema: errorEnvelope },
      },
      handler: async ({ body, headers }, _req, res) => {
        const { transfer, created } = await service.create({
          idempotencyKey: headers['idempotency-key'],
          fromAccountId: body.fromAccountId,
          toAccountId: body.toAccountId,
          amountCents: body.amountCents,
        });
        res.setHeader('Location', `/transfers/${transfer.id}`);
        return { status: created ? 202 : 200, body: toTransferDto(transfer) };
      },
    }),

    defineRoute({
      method: 'get',
      path: '/transfers/:transferId',
      summary: 'Get a single transfer (poll this for the async outcome)',
      tags: ['Transfers'],
      request: { params: transferParams },
      responses: {
        200: { description: 'The transfer', schema: transferResponse },
        404: { description: 'Transfer not found', schema: errorEnvelope },
      },
      handler: async ({ params }) => ({
        status: 200,
        body: toTransferDto(await service.getById(params.transferId)),
      }),
    }),
  ];
}
