import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import * as geoip from 'geoip-lite';

@Injectable()
export class AppService {
  greetings(req: Request) {
    const now = new Date();
    const timeZone = this.resolveUserTimeZone(req);

    // 1. Extract the exact 24-hour value (0-23) in the resolved timezone
    const hourPart = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone,
    })
      .formatToParts(now)
      .find((part) => part.type === 'hour')?.value;

    const hour = hourPart ? parseInt(hourPart, 10) % 24 : now.getHours();

    // 2. Greeting based on user's local hour
    let greeting = 'Good evening';
    if (hour >= 5 && hour < 12) {
      greeting = 'Good morning';
    } else if (hour >= 12 && hour < 17) {
      greeting = 'Good afternoon';
    }

    // 3. Formatted Local Time (e.g., "08:30:15 AM")
    const localTime = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone,
    }).format(now);

    // 4. Formatted Local Date (e.g., "Mon, Nov 2, 2026")
    const localDate = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone,
    }).format(now);

    // 5. UTC Offset (e.g., "GMT+1")
    const timeZoneOffset =
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset',
      })
        .formatToParts(now)
        .find((part) => part.type === 'timeZoneName')?.value || 'UTC';

    return {
      greeting,
      message: 'Elite Wholesalers',
      localTime,
      localDate,
      timeZone,
      timeZoneOffset,
      environment: process.env.NODE_ENV || 'development',
      year: now.getFullYear(),
    };
  }

  private resolveUserTimeZone(req: Request): string {
    // 1. Check if a CDN/Proxy (Vercel, Cloudflare, AWS) already injected the user's timezone
    const headerTz =
      (req.headers['x-timezone'] as string) ||
      (req.headers['x-vercel-ip-timezone'] as string) ||
      (req.headers['cf-timezone'] as string);

    if (headerTz && this.isValidTimeZone(headerTz)) {
      return headerTz;
    }

    // 2. Extract Client IP (handles reverse proxies via x-forwarded-for)
    const forwarded = req.headers['x-forwarded-for'];
    const rawIp =
      (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) ||
      req.socket?.remoteAddress ||
      req.ip ||
      '';

    // Strip IPv6-mapped IPv4 prefix if present
    const clientIp = rawIp.replace(/^::ffff:/, '');

    // 3. Look up timezone from IP using geoip-lite
    if (clientIp && clientIp !== '127.0.0.1' && clientIp !== '::1') {
      const geo = geoip.lookup(clientIp);
      if (geo?.timezone && this.isValidTimeZone(geo.timezone)) {
        return geo.timezone;
      }
    }

    // 4. Localhost / Docker fallback (uses DEFAULT_TZ env var, host OS, or Africa/Lagos)
    const fallbackTz =
      process.env.DEFAULT_TZ ||
      process.env.TZ ||
      Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (
      fallbackTz &&
      fallbackTz !== 'UTC' &&
      this.isValidTimeZone(fallbackTz)
    ) {
      return fallbackTz;
    }

    return 'Africa/Lagos';
  }

  private isValidTimeZone(tz: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }
}
