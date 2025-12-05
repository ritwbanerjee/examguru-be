import { Injectable } from '@nestjs/common';
import { uptime } from 'process';

@Injectable()
export class AppService {
  getHealth() {
    return {
      status: 'ok',
      uptime: Math.round(uptime()),
      timestamp: new Date().toISOString()
    };
  }
}
