
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ZohoInventoryService } from './zoho-inventory.service';
import { ZohoService } from './zoho.service';

describe('ZohoInventoryService - sales order reconciliation', () => {
  const customerId = '1969240000038693002';
  const referenceNumber =
    'EWS-a2592655-6f46-4250-b849-c26cb87ba000';

  let service: ZohoInventoryService;
  let inventoryGet: jest.Mock;
  let inventoryPost: jest.Mock;
  let inventoryPut: jest.Mock;
  let inventoryDelete: jest.Mock;

  const makeOrder = (
    id: string,
    reference: string = referenceNumber,
    customer: string = customerId,
  ) => ({
    salesorder_id: id,
    customer_id: customer,
    reference_number: reference,
    salesorder_number: `SO-${id}`,
    status: 'draft',
    total: 338.8,
    currency_code: 'AUD',
  });

  const makePage = (
    orders: ReturnType<typeof makeOrder>[],
    page = 1,
    hasMore = false,
  ) => ({
    salesorders: orders,
    page_context: {
      page,
      per_page: 200,
      has_more_page: hasMore,
    },
  });

  beforeEach(() => {
    inventoryGet = jest.fn();
    inventoryPost = jest.fn();
    inventoryPut = jest.fn();
    inventoryDelete = jest.fn();

    const inventoryClient = {
      get: inventoryGet,
      post: inventoryPost,
      put: inventoryPut,
      delete: inventoryDelete,
    };

    const commerceClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    };

    const zohoServiceMock = {
      createClient: jest.fn(
        (path: string) =>
          path === '/inventory/v1'
            ? inventoryClient
            : commerceClient,
      ),
    };

    service = new ZohoInventoryService(
      zohoServiceMock as unknown as ZohoService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns NOT_FOUND when no matching order exists', async () => {
    inventoryGet.mockResolvedValue(
      makePage([makeOrder('100', 'OTHER-REFERENCE')]),
    );

    const result =
      await service.reconcileSalesOrderByReference(
        customerId,
        referenceNumber,
      );

    expect(result.status).toBe('NOT_FOUND');
    expect(result.match_count).toBe(0);
    expect(result.matches).toEqual([]);
    expect(result.pages_checked).toBe(1);
    expect(result.search_complete).toBe(true);
  });

  it('returns FOUND when exactly one matching order exists', async () => {
    inventoryGet.mockResolvedValue(
      makePage([makeOrder('101')]),
    );

    const result =
      await service.reconcileSalesOrderByReference(
        customerId,
        referenceNumber,
      );

    expect(result.status).toBe('FOUND');
    expect(result.match_count).toBe(1);
    expect(result.matches[0].salesorder_id).toBe('101');
  });

  it('returns DUPLICATE when two orders match', async () => {
    inventoryGet.mockResolvedValue(
      makePage([
        makeOrder('101'),
        makeOrder('102'),
      ]),
    );

    const result =
      await service.reconcileSalesOrderByReference(
        customerId,
        referenceNumber,
      );

    expect(result.status).toBe('DUPLICATE');
    expect(result.match_count).toBe(2);
  });

  it('searches multiple pages before returning FOUND', async () => {
    inventoryGet
      .mockResolvedValueOnce(
        makePage(
          [makeOrder('100', 'OTHER-REFERENCE')],
          1,
          true,
        ),
      )
      .mockResolvedValueOnce(
        makePage([makeOrder('101')], 2, false),
      );

    const result =
      await service.reconcileSalesOrderByReference(
        customerId,
        referenceNumber,
      );

    expect(result.status).toBe('FOUND');
    expect(result.pages_checked).toBe(2);

    expect(inventoryGet).toHaveBeenNthCalledWith(
      1,
      '/salesorders',
      {
        params: {
          customer_id: customerId,
          page: 1,
          per_page: 200,
        },
      },
    );

    expect(inventoryGet).toHaveBeenNthCalledWith(
      2,
      '/salesorders',
      {
        params: {
          customer_id: customerId,
          page: 2,
          per_page: 200,
        },
      },
    );
  });

  it('detects matching orders on different pages', async () => {
    inventoryGet
      .mockResolvedValueOnce(
        makePage([makeOrder('101')], 1, true),
      )
      .mockResolvedValueOnce(
        makePage([makeOrder('102')], 2, false),
      );

    const result =
      await service.reconcileSalesOrderByReference(
        customerId,
        referenceNumber,
      );

    expect(result.status).toBe('DUPLICATE');
    expect(result.match_count).toBe(2);
  });

  it('fails safely when the Zoho API rejects the request', async () => {
    inventoryGet.mockRejectedValue(
      new Error('Zoho API unavailable'),
    );

    await expect(
      service.reconcileSalesOrderByReference(
        customerId,
        referenceNumber,
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects a response without pagination information', async () => {
    inventoryGet.mockResolvedValue({
      salesorders: [makeOrder('101')],
    });

    await expect(
      service.reconcileSalesOrderByReference(
        customerId,
        referenceNumber,
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects an incorrect page number', async () => {
    inventoryGet.mockResolvedValue(
      makePage([makeOrder('101')], 3, false),
    );

    await expect(
      service.reconcileSalesOrderByReference(
        customerId,
        referenceNumber,
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects repeated sales order IDs across pages', async () => {
    inventoryGet
      .mockResolvedValueOnce(
        makePage([makeOrder('101')], 1, true),
      )
      .mockResolvedValueOnce(
        makePage([makeOrder('101')], 2, false),
      );

    await expect(
      service.reconcileSalesOrderByReference(
        customerId,
        referenceNumber,
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects orders belonging to another customer', async () => {
    inventoryGet.mockResolvedValue(
      makePage([
        makeOrder(
          '101',
          referenceNumber,
          'DIFFERENT-CUSTOMER',
        ),
      ]),
    );

    await expect(
      service.reconcileSalesOrderByReference(
        customerId,
        referenceNumber,
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects missing sales order IDs', async () => {
    inventoryGet.mockResolvedValue(
      makePage([
        {
          ...makeOrder('101'),
          salesorder_id: '',
        },
      ]),
    );

    await expect(
      service.reconcileSalesOrderByReference(
        customerId,
        referenceNumber,
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects empty pages when Zoho reports more pages', async () => {
    inventoryGet.mockResolvedValue(
      makePage([], 1, true),
    );

    await expect(
      service.reconcileSalesOrderByReference(
        customerId,
        referenceNumber,
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects invalid payment references', async () => {
    await expect(
      service.reconcileSalesOrderByReference(
        customerId,
        'INVALID-REFERENCE',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(inventoryGet).not.toHaveBeenCalled();
  });

  it('rejects an empty customer ID', async () => {
    await expect(
      service.reconcileSalesOrderByReference(
        '',
        referenceNumber,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(inventoryGet).not.toHaveBeenCalled();
  });

  it('never writes to Zoho during reconciliation', async () => {
    inventoryGet.mockResolvedValue(
      makePage([makeOrder('101')]),
    );

    await service.reconcileSalesOrderByReference(
      customerId,
      referenceNumber,
    );

    expect(inventoryPost).not.toHaveBeenCalled();
    expect(inventoryPut).not.toHaveBeenCalled();
    expect(inventoryDelete).not.toHaveBeenCalled();
  });

  it('rejects malformed sales order arrays', async () => {
    inventoryGet.mockResolvedValue({
      salesorders: null,
      page_context: {
        page: 1,
        per_page: 200,
        has_more_page: false,
      },
    });

    await expect(
      service.reconcileSalesOrderByReference(
        customerId,
        referenceNumber,
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
