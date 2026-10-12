import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

@Injectable()
export class LoginDto {
  @ApiProperty({ example: 'web@elitewholesalers.com.au' })
  @IsString()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '#StrongPass@1' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'web@elitewholesalers.com.au' })
  @IsString()
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class GoogleLoginDto {
  @ApiProperty({ example: 'sdksndkssubduve33uewnwiw' })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class CreateVerificationDto {
  @IsNotEmpty()
  @IsNumber()
  userId: string;

  @ApiProperty({ example: '3456' })
  @IsNotEmpty()
  @IsString()
  verification_code: string;

  @IsOptional()
  @IsDateString()
  expire_at?: Date;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'web@elitewholesalers.com.au' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '@Password123' })
  @IsNotEmpty()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password: string;

  @ApiProperty({ example: '3456' })
  @IsNotEmpty()
  @IsString()
  verification_code: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'web@elitewholesalers.com.au' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '3456' })
  @IsNotEmpty()
  @IsString()
  verification_code: string;
}
