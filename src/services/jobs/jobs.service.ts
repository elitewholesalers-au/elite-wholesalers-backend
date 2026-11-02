import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Verification } from '../../modules/auth/entities/auth.entity';

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Verification)
    private readonly verificationRepository: Repository<Verification>,
  ) {}
  private readonly logger = new Logger(JobsService.name);

  @Cron('45 * * * * *')
  handleDatabaseKeepAlive() {
    this.logger.debug('Called when the current second is 45');
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async handleKeepAlive() {
    try {
      this.logger.log('Sending keep-alive ping to Neon database...');
      await this.verificationRepository.count();
      this.logger.log('Database keep-alive successful.');
    } catch (error) {
      this.logger.error('Failed to ping Neon database:', error);
    }
  }
}
