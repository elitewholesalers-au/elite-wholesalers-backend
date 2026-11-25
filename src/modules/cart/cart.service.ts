import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateCartDto } from './dto/create-cart.dto';
import { UpdateCartDto } from './dto/update-cart.dto';
import { InternalServerErrorException } from '@nestjs/common';
import { ZohoInventoryService } from '../zoho/zoho-inventory.service';
import { UserService } from '../user/user.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cart } from './entities/cart.entity';
import { AccountType, DeliveryMethod } from '../user/dto/create-user.dto';
import { generatePriceByAccountType } from '../../common/utils/price-generator.utils';
import { CommerceService } from '../commerce/commerce.service';
import { shippingFees } from './shipping-fees';
// import { ZohoApiClient } from './zoho-api.util'; // Your HTTP client
// import { UserRepository } from '../user/user.repository';
// Trigger Railway staging deployment for WEEKLY20 checkout preview
const WEEKLY20_PROMO_CODE = 'WEEKLY20';
const WEEKLY20_DISCOUNT_RATE = 0.20;

function isEliteAlarmsProduct(product: {
  brand?: string;
  category_name?: string;
}): boolean {
  return (
    product.brand?.trim().toUpperCase() === 'ELITE ALARMS' ||
    product.category_name?.trim().toUpperCase() === 'ELITE ALARMS'
  );
}
@Injectable()
export class CartService {
  constructor(
    private zohoInventoryService: ZohoInventoryService,
    private userService: UserService,
    private commerceService: CommerceService,

    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
  ) {}

  private logger = new Logger(CartService.name);

  async getCart(userId: string, accountType: AccountType) {
    const cartItems = await this.cartRepository.find({ where: { userId } });
    const productIds = cartItems.map((cart) => cart.itemId);
    const products = await Promise.all(
      productIds.map((productId) =>
        this.zohoInventoryService.getInventoryItem(productId),
      ),
    );

    return cartItems.map((item) => {
      const product = products
        .map(generatePriceByAccountType(accountType))
        .find((product) => product.item_id === item.itemId);
      return {
        ...item,
        product,
      };
    });
  }

  async addToCart(userId: string, zohoContactId: string, dto: CreateCartDto) {
    let cartItem = await this.cartRepository.findOne({
      where: { userId, itemId: dto.item_id },
    });

    if (cartItem) {
      cartItem.quantity += dto.quantity;
      cartItem.price = dto.price;
      cartItem.zohoContactId = zohoContactId;
    } else {
      cartItem = this.cartRepository.create({
        userId,
        itemId: dto.item_id,
        quantity: dto.quantity,
        zohoContactId: zohoContactId,
        image_url: dto.image_url,
        price: dto.price,
      });
    }

    // Entity lifecycle hooks will automatically recalculate `total` on save
    return await this.cartRepository.save(cartItem);
  }

  async updateCartItem(userId: string, cartId: string, dto: UpdateCartDto) {
    const cartItem = await this.cartRepository.findOne({
      where: { cartId, userId },
    });

    if (!cartItem) {
      throw new NotFoundException('Cart item not found');
    }

    cartItem.quantity = dto.quantity;
    // Saving triggers `@BeforeUpdate`, which recalculates `total` using the new quantity
    return await this.cartRepository.save(cartItem);
  }

  async deleteCartItem(userId: string, cartId: string) {
    const cartItem = await this.cartRepository.findOne({
      where: { cartId, userId },
    });

    if (!cartItem) {
      throw new NotFoundException('Cart item not found');
    }

    await this.cartRepository.remove(cartItem);
    return { message: 'Cart item removed successfully' };
  }

  async clearCart(userId: string) {
    await this.cartRepository.delete({ userId });
    return { message: 'Cart cleared successfully' };
  }
 async previewCheckout(
    userId: string,
    accountType: AccountType,
    deliveryMethod: DeliveryMethod,
    promoCode?: string,
  ) {
    const cartItems = await this.cartRepository.find({
      where: { userId },
    });

    if (cartItems.length === 0) {
      throw new NotFoundException('Your cart is empty');
    }

    const normalizedPromoCode = promoCode?.trim().toUpperCase();

    if (
      normalizedPromoCode &&
      normalizedPromoCode !== WEEKLY20_PROMO_CODE
    ) {
      throw new BadRequestException('Invalid promotional code');
    }

    const roundMoney = (value: number) =>
      Math.round((value + Number.EPSILON) * 100) / 100;

    const items = await Promise.all(
      cartItems.map(async (item) => {
        const product =
          await this.zohoInventoryService.getInventoryItem(item.itemId);

        if (
          !product ||
          product.status?.toLowerCase() !== 'active' ||
          !product.can_be_sold
        ) {
          throw new BadRequestException(
            'A product in your cart is no longer available for sale',
          );
        }

        const pricedProduct =
          generatePriceByAccountType(accountType)(product);

        const normalPrice = pricedProduct.price.amount;

        if (!Number.isFinite(normalPrice) || normalPrice < 0) {
          throw new BadRequestException('Invalid product price');
        }

        const eligible =
          normalizedPromoCode === WEEKLY20_PROMO_CODE &&
          isEliteAlarmsProduct(product);

        const finalPrice = eligible
          ? roundMoney(normalPrice * (1 - WEEKLY20_DISCOUNT_RATE))
          : roundMoney(normalPrice);

        return {
          item_id: item.itemId,
          name: product.name,
          sku: product.sku,
          quantity: item.quantity,
          original_unit_price: roundMoney(normalPrice),
          discounted_unit_price: finalPrice,
          original_total: roundMoney(normalPrice * item.quantity),
          discounted_total: roundMoney(finalPrice * item.quantity),
          discount_amount: roundMoney(
            (roundMoney(normalPrice) - finalPrice) * item.quantity,
          ),
          eligible_for_discount: eligible,
        };
      }),
    );

    const originalSubtotal = roundMoney(
      items.reduce((sum, item) => sum + item.original_total, 0),
    );

    const discountedSubtotal = roundMoney(
      items.reduce((sum, item) => sum + item.discounted_total, 0),
    );

    const discountAmount = roundMoney(
      originalSubtotal - discountedSubtotal,
    );

    // Shipping is based on the ORIGINAL order value.
    const matchingTier = shippingFees.find(
      (tier) =>
        originalSubtotal >= tier.min &&
        originalSubtotal <= tier.max,
    );

    const shippingCharge =
      deliveryMethod === DeliveryMethod.SHIPPING
        ? matchingTier?.fee ?? 0
        : 0;

    // Prices and shipping are GST-exclusive. Calculate GST for the
    // read-only preview; Zoho remains responsible for actual order tax.
    const subtotalExGst = roundMoney(discountedSubtotal + shippingCharge);
    const gstAmount = roundMoney(subtotalExGst * 0.10);
    const totalIncGst = roundMoney(subtotalExGst + gstAmount);

    return {
      promo_code: normalizedPromoCode || null,
      items,
      original_subtotal: originalSubtotal,
      discount_amount: discountAmount,
      discounted_subtotal: discountedSubtotal,
      shipping_charge: shippingCharge,
      subtotal_ex_gst: subtotalExGst,
      gst_amount: gstAmount,
      total_inc_gst: totalIncGst,
    };
  }
  async initializeCheckout(
    userId: string,
    accountType: AccountType,
    deliveryMethod: DeliveryMethod,
    promoCode?: string,
  ) {
    // 1. Fetch user and verify Zoho sync
    const user = await this.userService.findOne({ id: userId });
    if (!user || !user.zohoContactId) {
      throw new InternalServerErrorException('User is not synced with Zoho');
    }

    // 2. Fetch ALL cart items for this user from the database
    const cartItems = await this.cartRepository.find({ where: { userId } });

    if (!cartItems || cartItems.length === 0) {
      throw new NotFoundException('Your cart is empty');
    }

   const originalPrices = await Promise.all(
  cartItems.map(async (item) => {
    const product = await this.zohoInventoryService.getInventoryItem(
      item.itemId,
    );

    if (!product) {
      throw new BadRequestException('A product in your cart is unavailable');
    }

    const pricedProduct = generatePriceByAccountType(accountType)(product);
if (
  !Number.isFinite(pricedProduct.price.amount) ||
  pricedProduct.price.amount < 0
) {
  throw new BadRequestException('Invalid product price');
}
    return Math.round(pricedProduct.price.amount * 100) / 100 * item.quantity;
  }),
);

const subtotal = Math.round(
  originalPrices.reduce((sum, amount) => sum + amount, 0) * 100,
) / 100;
const normalizedPromoCode = promoCode?.trim().toUpperCase();

if (
  normalizedPromoCode &&
  normalizedPromoCode !== WEEKLY20_PROMO_CODE
) {
  throw new BadRequestException('Invalid promotional code');
}
    // Step 2: Find the matching shipping tier
    const matchingTier = shippingFees.find(
      (tier) => subtotal >= tier.min && subtotal <= tier.max,
    );

    const shippingFee = matchingTier ? matchingTier.fee : 0;

    let shipping_charge = 0;

    if (deliveryMethod === DeliveryMethod.SHIPPING) {
      shipping_charge = shippingFee;
    }

    // 3. Map database cart items to Zoho line items safely using backend price
    const soLineItems = await Promise.all(
  cartItems.map(async (item) => {
    // Retrieve the current product details directly from Zoho.
    const product = await this.zohoInventoryService.getInventoryItem(
      item.itemId,
    );
    if (
  !product ||
  product.status?.toLowerCase() !== 'active' ||
  !product.can_be_sold
) {
      throw new BadRequestException(
        'A product in your cart is no longer available for sale',
      );
    }

    // Calculate the customer's normal Retail or Trade price.
    const pricedProduct = generatePriceByAccountType(accountType)(product);
    const normalPrice = pricedProduct.price.amount;

    if (!Number.isFinite(normalPrice) || normalPrice < 0) {
      throw new BadRequestException('Invalid product price');
    }
this.logger.log(
  `WEEKLY20 CHECK: ${JSON.stringify({
    itemId: item.itemId,
    brand: product.brand,
    category: product.category_name,
    promoReceived: normalizedPromoCode,
  })}`,
);
    // Apply WEEKLY20 only to ELITE ALARMS products.
    const isEligible =
      normalizedPromoCode === WEEKLY20_PROMO_CODE &&
      isEliteAlarmsProduct(product);

    const finalPrice = isEligible
      ? Math.round(
          normalPrice * (1 - WEEKLY20_DISCOUNT_RATE) * 100,
        ) / 100
      : Math.round(normalPrice * 100) / 100;

    return {
      item_id: item.itemId,
      quantity: item.quantity,
      rate: finalPrice,
      custom_fields: [
       {
          label: 'accountType',
          value: accountType,
        },
        {
          label: 'sellingPrice',
          value: finalPrice,
        },
      ],
    };
  }),
); 
    const salesOrderPayload = {
      customer_id: user.zohoContactId,
      shipping_charge,
      delivery_method: deliveryMethod,
      line_items: soLineItems,
      date: new Date().toISOString().split('T')[0],
      status: 'confirmed',
    };

    try {
      const salesOrder =
        await this.zohoInventoryService.createSalesOrder(salesOrderPayload);
      const salesOrderId: string = salesOrder.salesorder_id;
      const paymentDetails = await this.commerceService.pay(userId, salesOrderId);
      return paymentDetails;
    } catch (error) {
      console.error(
        'Zoho Checkout Error:',
        error.response?.data || error.message,
      );
      throw new InternalServerErrorException(
        'Failed to generate Zoho checkout link',
      );
    }
  }
}
