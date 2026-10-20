import type { DB } from '../index.ts';
import { CategoryRepo, ProductRepo, PromoRepo } from './catalog.ts';
import { RateRepo } from './rates.ts';
import { ScreenRepo } from './screens.ts';
import { SettingsRepo } from './settings.ts';

export interface Repos {
  categories: CategoryRepo;
  products: ProductRepo;
  promos: PromoRepo;
  screens: ScreenRepo;
  rates: RateRepo;
  settings: SettingsRepo;
}

export function createRepos(db: DB): Repos {
  return {
    categories: new CategoryRepo(db),
    products: new ProductRepo(db),
    promos: new PromoRepo(db),
    screens: new ScreenRepo(db),
    rates: new RateRepo(db),
    settings: new SettingsRepo(db),
  };
}
