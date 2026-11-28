
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { CheckoutPayment } from './entities/checkout-payment.entity';
import { PaymentFirstFulfilmentService } from './payment-first-fulfilment.service';

describe('PaymentFirstFulfilmentService', () => {
  let service: PaymentFirstFulfilmentService;

  let config: {
    get: jest.Mock;
  };

  let repository: {
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  let queryBuilder: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    returning: jest.Mock;
    execute: jest.Mock;
  };

  const paymentId =
    'a2592655-6f46-4250-b849-c26cb87ba000';

  function makePayment(
    overrides: Partial<CheckoutPayment> = {},
  ): CheckoutPayment {
    return {
      id: paymentId,
      paymentMethod: 'stripe',
      paymentStatus: 'paid',
      paymentVerifiedAt: new Date(),
      stripeCheckoutSessionId: 'cs_test_example',
      stripePaymentIntentId: 'pi_test_example',
      currency: 'AUD',
      zohoContactId: '1969240000038693002',
      zohoSalesorderId: null,
      fulfilmentStatus: 'not_started',
      subtotalExGst: '308.00',
      shippingExGst: '0.00',
      gstAmount: '30.80',
      totalIncGst: '338.80',
      orderSnapshot: {
        items: [
          {
            item_id: '1969240000038767010',
            quantity: 1,
            discounted_unit_price: 308,
            discounted_total: 308,
          },
        ],
        subtotal_ex_gst: 308,
        shipping_charge: 0,
        gst_amount: 30.8,
        total_inc_gst: 338.8,
      },
      ...overrides,
    } as CheckoutPayment;
  }

  beforeEach(() => {
    config = {
      get: jest.fn().mockReturnValue('staging'),
    };

    queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        affected: 1,
        raw: [
          {
            id: paymentId,
            payment_status: 'paid',
            fulfilment_status: 'processing',
          },
        ],
      }),
    };

    repository = {
      findOne: jest.fn().mockResolvedValue(makePayment()),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    service = new PaymentFirstFulfilmentService(
      config as unknown as ConfigService,
      repository as unknown as Repository<CheckoutPayment>,
    );
  });

  it('previews a valid paid order without writing to the database', async () => {
    const result = await service.previewZohoSalesOrder(
      paymentId,
    );

    expect(result.mode).toBe('DRY_RUN');
    expect(result.zoho_order_created).toBe(false);
    expect(result.expected_total_inc_gst).toBe(338.8);
    expect(result.proposed_sales_order).toEqual({
      customer_id: '1969240000038693002',
      reference_number: `EWS-${paymentId}`,
      line_items: [
        {
          item_id: '1969240000038767010',
          quantity: 1,
          rate: 308,
        },
      ],
      shipping_charge: 0,
    });

    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('claims a verified Stripe payment once', async () => {
    const result =
      await service.claimPaymentForFulfilment(paymentId);

    expect(result.claimed).toBe(true);
    expect(result.fulfilment_status).toBe('processing');
    expect(result.zoho_order_created).toBe(false);

    expect(queryBuilder.execute).toHaveBeenCalledTimes(1);
    expect(queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        fulfilmentStatus: 'processing',
        failureReason: null,
      }),
    );
  });

  it('rejects a duplicate claim when the atomic update affects no rows', async () => {
    queryBuilder.execute.mockResolvedValue({
      affected: 0,
      raw: [],
    });

    await expect(
      service.claimPaymentForFulfilment(paymentId),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(queryBuilder.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects an unpaid Stripe payment', async () => {
    repository.findOne.mockResolvedValue(
      makePayment({
        paymentStatus: 'pending',
        paymentVerifiedAt: null,
      }),
    );

    await expect(
      service.claimPaymentForFulfilment(paymentId),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(queryBuilder.execute).not.toHaveBeenCalled();
  });

  it('rejects a payment already marked processing', async () => {
    repository.findOne.mockResolvedValue(
      makePayment({
        fulfilmentStatus: 'processing',
      }),
    );

    await expect(
      service.claimPaymentForFulfilment(paymentId),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(queryBuilder.execute).not.toHaveBeenCalled();
  });

  it('rejects an order with an incorrect total', async () => {
    repository.findOne.mockResolvedValue(
      makePayment({
        totalIncGst: '400.00',
      }),
    );

    await expect(
      service.claimPaymentForFulfilment(paymentId),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(queryBuilder.execute).not.toHaveBeenCalled();
  });

  it('blocks fulfilment testing outside staging', async () => {
    config.get.mockReturnValue('production');

    await expect(
      service.claimPaymentForFulfilment(paymentId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(repository.findOne).not.toHaveBeenCalled();
    expect(queryBuilder.execute).not.toHaveBeenCalled();
  });
});
