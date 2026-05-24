import { Injectable, Logger } from '@nestjs/common';
import { ObservabilitySink } from './observability.sink';
import { ObservabilityRecord } from './observability.types';

@Injectable()
export class StdoutObservabilitySink implements ObservabilitySink {
  private readonly logger = new Logger('Observability');

  write(record: ObservabilityRecord): void {
    this.logger.log(JSON.stringify(record));
  }
}
