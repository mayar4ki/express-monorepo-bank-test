import { defineRoute } from '@bank/shared';
import { errorEnvelope } from '@bank/shared';
import { transferHistoryResponse } from '../transfers/schemas.js';
import type { AccountService } from './service.js';
import {
  accountDetailResponse,
  accountParams,
  accountResponse,
  balanceResponse,
  createAccountBody,
  historyQuery,
} from './schemas.js';

export function accountRoutes(service: AccountService) {
  return [
    defineRoute({
      method: 'post',
      path: '/accounts',
      summary: 'Open a bank account with an initial deposit',
      tags: ['Accounts'],
      request: { body: createAccountBody },
      responses: {
        201: { description: 'Account created', schema: accountResponse },
        400: { description: 'Validation error', schema: errorEnvelope },
        404: { description: 'Customer not found', schema: errorEnvelope },
      },
      handler: async ({ body }) => ({
        status: 201,
        body: await service.create(body.customerId, body.initialDepositCents),
      }),
    }),

    defineRoute({
      method: 'get',
      path: '/accounts/:accountId',
      summary: 'Get an account (includes lock status)',
      tags: ['Accounts'],
      request: { params: accountParams },
      responses: {
        200: { description: 'The account', schema: accountDetailResponse },
        404: { description: 'Account not found', schema: errorEnvelope },
      },
      handler: async ({ params }) => ({
        status: 200,
        body: await service.getDetail(params.accountId),
      }),
    }),

    defineRoute({
      method: 'get',
      path: '/accounts/:accountId/balance',
      summary: 'Get the balance of an account',
      tags: ['Accounts'],
      request: { params: accountParams },
      responses: {
        200: { description: 'The current balance', schema: balanceResponse },
        404: { description: 'Account not found', schema: errorEnvelope },
      },
      handler: async ({ params }) => ({
        status: 200,
        body: await service.getBalance(params.accountId),
      }),
    }),

    defineRoute({
      method: 'get',
      path: '/accounts/:accountId/transfers',
      summary: 'Transfer history of an account (newest first)',
      tags: ['Accounts'],
      request: { params: accountParams, query: historyQuery },
      responses: {
        200: {
          description: 'Transfers in and out of the account',
          schema: transferHistoryResponse,
        },
        404: { description: 'Account not found', schema: errorEnvelope },
      },
      handler: async ({ params, query }) => ({
        status: 200,
        body: await service.getHistory(params.accountId, query.limit, query.cursor),
      }),
    }),
  ];
}
