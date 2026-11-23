import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import * as http from 'http';

export interface Response<T> {
  meta: {
    success: boolean;
    statusCode: number;
    statusMessage: string;
  };
  data: T;
  timestamp: string;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    return next.handle().pipe(
      map((data) => {
        // Inside map((data) => { ... })
        const ctx = context.switchToHttp();
        const response = ctx.getResponse();
        const statusCode = response.statusCode;

        let statusMessage = http.STATUS_CODES[statusCode] || 'SUCCESS';
        let payload = data;
        if (data && typeof data === 'object' && 'message' in data) {
          statusMessage = data.message;
          if ('data' in data) {
            payload = data.data;
          } else {
            const rest = { ...data };
            delete rest.message;
            payload = rest;
          }
        }

        return {
          meta: { success: true, statusCode, statusMessage },
          data: payload,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
