import { z } from 'zod';

import { idSchema } from '@bank/shared';

export const customerParams = z.object({ customerId: idSchema });

export const createCustomerBody = z
  .object({
    name: z.string().trim().min(1).max(200).meta({ example: 'Ada Lovelace' }),
  })
  .meta({ id: 'CreateCustomer' });

export const customerResponse = z
  .object({
    id: z.uuid(),
    name: z.string().meta({ example: 'Arisha Barron' }),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Customer' });

export const customerListResponse = z.array(customerResponse);
