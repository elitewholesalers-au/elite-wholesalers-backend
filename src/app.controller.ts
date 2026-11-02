import { Controller, Get, Headers, Render, Req } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from './common/decorators';
import type { Request } from 'express';

@Controller()
@ApiExcludeController()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  @Render('index')
  root(@Req() req: Request) {
    const payload = this.appService.greetings(req);
    return payload;
  }
}
