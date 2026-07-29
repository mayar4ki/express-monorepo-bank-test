import { defineRoute } from '@bank/shared';
import { errorEnvelope } from '@bank/shared';
import { accountListResponse } from '../accounts/schemas.js';
import type { CustomerService } from './service.js';
import {
  createCustomerBody,
  customerListResponse,
  customerParams,
  customerResponse,
} from './schemas.js';

export function customerRoutes(service: CustomerService) {
  return [
    defineRoute({
      method: 'get',
      path: '/customers',
      summary: 'List all customers',
      tags: ['Customers'],
      responses: { 200: { description: 'All customers', schema: customerListResponse } },
      handler: async () => ({ status: 200, body: await service.list() }),
    }),

    defineRoute({
      method: 'post',
      path: '/customers',
      summary: 'Create a customer',
      tags: ['Customers'],
      request: { body: createCustomerBody },
      responses: {
        201: { description: 'Customer created', schema: customerResponse },
        400: { description: 'Validation error', schema: errorEnvelope },
      },
      handler: async ({ body }) => ({ status: 201, body: await service.create(body.name) }),
    }),

    defineRoute({
      method: 'get',
      path: '/customers/:customerId',
      summary: 'Get a customer',
      tags: ['Customers'],
      request: { params: customerParams },
      responses: {
        200: { description: 'The customer', schema: customerResponse },
        404: { description: 'Customer not found', schema: errorEnvelope },
      },
      handler: async ({ params }) => ({
        status: 200,
        body: await service.getById(params.customerId),
      }),
    }),

    defineRoute({
      method: 'get',
      path: '/customers/:customerId/accounts',
      summary: "List a customer's accounts",
      tags: ['Customers'],
      request: { params: customerParams },
      responses: {
        200: { description: "The customer's accounts", schema: accountListResponse },
        404: { description: 'Customer not found', schema: errorEnvelope },
      },
      handler: async ({ params }) => ({
        status: 200,
        body: await service.listAccounts(params.customerId),
      }),
    }),
  ];
}
