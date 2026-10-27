import type { TorrentResult } from '../../shared/types';
import { ProviderError, type ProviderSearchOptions, type TorrentProvider } from './provider';

/**
 * Реестр источников, которые пользователь попросил показывать, но которые нельзя
 * подключать без учётной записи или надёжного публичного интерфейса. Он намеренно
 * не создаёт фиктивную выдачу и не пытается обходить ограничения ресурса.
 */
export class UnavailableProvider implements TorrentProvider {
  constructor(readonly id: string, readonly name: string, readonly reason: string) {}

  async search(_options: ProviderSearchOptions): Promise<TorrentResult[]> {
    throw new ProviderError(this.reason, this.reason);
  }

  async check(): Promise<void> {
    throw new ProviderError(this.reason, this.reason);
  }
}
