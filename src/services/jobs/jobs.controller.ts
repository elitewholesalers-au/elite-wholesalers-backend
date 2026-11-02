import { Controller } from '@nestjs/common';
import { JobsService } from './jobs.service';

@Controller()
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}
}
