
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';

import { CartService } from './cart.service';
import { PaymentFirstCheckoutService } from './payment-first-checkout.service';
import {
  CreateCartDto,
  DeliveryMethodDto,
} from './dto/create-cart.dto';
import { UpdateCartDto } from './dto/update-cart.dto';
import type { IRequest } from '../../common/interface';

@ApiTags('Cart')
@Controller('cart')
export class CartController {
  constructor(
    private readonly cartService: CartService,
    private readonly paymentFirstCheckoutService:
      PaymentFirstCheckoutService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Add an item to the cart' })
  @ApiResponse({
    status: 201,
    description: 'Item successfully added to cart.',
  })
  @ApiResponse({ status: 400, description: 'Bad Request.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async addToCart(
    @Req() req: IRequest,
    @Body() dto: CreateCartDto,
  ) {
    const userId = req.user.id;
    const zohoContactId = req.user?.zohoContactId;

    return await this.cartService.addToCart(
      userId,
      zohoContactId,
      dto,
    );
  }

  @Post('/checkout/preview')
  @ApiOperation({
    summary: 'Preview checkout totals without creating a Zoho order',
  })
  @ApiResponse({
    status: 201,
    description: 'Checkout preview calculated successfully.',
  })
  async previewCheckout(
    @Req() req: IRequest,
    @Body() deliveryMethodDto: DeliveryMethodDto,
  ) {
    return await this.cartService.previewCheckout(
      req.user.id,
      req.user.accountType,
      deliveryMethodDto.delivery_method,
      deliveryMethodDto.promo_code,
    );
  }

  @Post('/checkout/prepare')
  @ApiOperation({
    summary: 'Prepare a pending payment for secure checkout',
  })
  @ApiResponse({
    status: 201,
    description: 'Pending payment prepared successfully.',
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication required.',
  })
  @ApiResponse({
    status: 503,
    description: 'Payment-first checkout is disabled.',
  })
  async prepareCheckout(
    @Req() req: IRequest,
    @Body() deliveryMethodDto: DeliveryMethodDto,
  ) {
    if (
      this.configService.get<string>(
        'PAYMENT_FIRST_CHECKOUT_ENABLED',
      ) !== 'true'
    ) {
      throw new ServiceUnavailableException(
        'Payment-first checkout is not enabled',
      );
    }

    const payment =
      await this.paymentFirstCheckoutService.preparePendingPayment(
        req.user.id,
        req.user.accountType,
        deliveryMethodDto.delivery_method,
        deliveryMethodDto.promo_code,
      );

    return {
      payment_id: payment.id,
      payment_status: payment.paymentStatus,
      currency: payment.currency,
      total_inc_gst: payment.totalIncGst,
    };
  }

  @Post('/checkout')
  @ApiOperation({
    summary: 'Initialize checkout for all items in the user cart',
  })
  @ApiResponse({
    status: 201,
    description: 'Checkout initialized successfully.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cart is empty.',
  })
  @ApiResponse({
    status: 503,
    description: 'Checkout temporarily unavailable.',
  })
  async checkout(
    @Req() req: IRequest,
    @Body() deliveryMethodDto: DeliveryMethodDto,
  ) {
    if (
      this.configService.get<string>(
        'ZOHO_ORDER_CREATION_ENABLED',
      ) !== 'true'
    ) {
      throw new ServiceUnavailableException(
        'Checkout is temporarily unavailable while secure payments are being configured.',
      );
    }

    return await this.cartService.initializeCheckout(
      req.user.id,
      req.user.accountType,
      deliveryMethodDto.delivery_method,
      deliveryMethodDto.promo_code,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get all items in the user cart' })
  @ApiResponse({
    status: 200,
    description: 'Returns all cart items for the user.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
  })
  async findAll(@Req() req: IRequest) {
    return await this.cartService.getCart(
      req.user.id,
      req.user.accountType,
    );
  }

  @Patch(':cartId')
  @ApiOperation({
    summary: 'Update cart item quantity',
  })
  @ApiParam({
    name: 'cartId',
    description: 'The unique ID of the cart item',
  })
  @ApiResponse({
    status: 200,
    description: 'Cart item successfully updated.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cart item not found.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
  })
  async updateCartItem(
    @Req() req: IRequest,
    @Param('cartId') cartId: string,
    @Body() dto: UpdateCartDto,
  ) {
    return await this.cartService.updateCartItem(
      req.user.id,
      cartId,
      dto,
    );
  }

  @Delete(':cartId')
  @ApiOperation({
    summary: 'Delete a single item from the cart',
  })
  @ApiParam({
    name: 'cartId',
    description: 'The unique ID of the cart item',
  })
  @ApiResponse({
    status: 200,
    description: 'Cart item successfully removed.',
  })
  @ApiResponse({
    status: 404,
    description: 'Cart item not found.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
  })
  async deleteCartItem(
    @Req() req: IRequest,
    @Param('cartId') cartId: string,
  ) {
    return await this.cartService.deleteCartItem(
      req.user.id,
      cartId,
    );
  }

  @Delete()
  @ApiOperation({
    summary: 'Clear all items from the user cart',
  })
  @ApiResponse({
    status: 200,
    description: 'Cart cleared successfully.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
  })
  async clearCart(@Req() req: IRequest) {
    return await this.cartService.clearCart(req.user.id);
  }
}
