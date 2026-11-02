import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Verification } from '../../modules/auth/entities/auth.entity';

@Module({
  imports: [ScheduleModule.forRoot(), TypeOrmModule.forFeature([Verification])],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
