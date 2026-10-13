import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsString,
  Min,
  ValidateNested,
  IsEnum,
  IsNotEmpty,
  IsPositive,
  IsUrl,
} from 'class-validator';
import { DeliveryMethod } from '../../user/dto/create-user.dto';

export enum Currency {
  AUD = 'AUD',
  USD = 'USD',
  NGN = 'NGN',
}

export class PriceDto {
  @ApiProperty({ example: 120.5 })
  @IsPositive()
  @Min(0)
  amount: number;

  @ApiProperty({ enum: Currency, example: Currency.AUD })
  @IsEnum(Currency)
  currency: Currency;
}

export class CreateCartDto {
  @ApiProperty({ required: true, example: '1969240000001034033' })
  @IsString()
  @IsNotEmpty()
  item_id: string;

  @ApiProperty({
    required: true,
    example:
      'https://cdn1.zohoecommerce.com/product-images/IXMV7W.jpg/1969240000035741108/600x600?storefront_domain=elitewholesalers.zohoecommerce.com',
  })
  @IsString()
  @IsUrl()
  image_url: string;

  @ApiProperty({ default: 1, example: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity = 1;

  @ApiProperty({ type: () => PriceDto })
  @ValidateNested()
  @Type(() => PriceDto)
  price: PriceDto;
}

export class DeliveryMethodDto {
  @ApiProperty({ enum: DeliveryMethod, example: DeliveryMethod.SHIPPING })
  @IsEnum(DeliveryMethod)
  delivery_method: DeliveryMethod;
}
