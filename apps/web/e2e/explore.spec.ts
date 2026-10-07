import { expect, test } from '@playwright/test';
import { setup } from './helpers.ts';

// PROJECT_PLAN §14.2 and the course requirements (§2.1): the Explore map has
// 20+ markers of more than one kind, popups and a filter.

test('the Explore map shows 20+ markers with popups and a filter', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await page.getByRole('radio', { name: 'Mapa' }).click();
  await expect(page.locator('.arcgis[data-ready]')).toBeVisible({ timeout: 60_000 });

  const markers = page.getByRole('list', { name: 'Marcadores del mapa' }).getByRole('listitem');
  expect(await markers.count()).toBeGreaterThanOrEqual(20);

  // A marker's popup, reached from the keyboard list (same as a tap).
  await page.getByRole('button', { name: 'Castelo de Leiria' }).focus();
  await page.keyboard.press('Enter');
  const viewRoute = page.getByRole('button', { name: 'Ver ruta' });
  await expect(viewRoute).toBeVisible();
  await expect(page.getByText('Monumento', { exact: true })).toBeVisible();
  await viewRoute.click();
  await expect(page).toHaveURL(/\/routes\/leiria-historica$/);

  // The filter: points of interest off leaves the route's 12 points.
  await page.goBack();
  await page.getByRole('radio', { name: 'Mapa' }).click();
  await page.getByRole('button', { name: 'Filtrar el mapa' }).click();
  await page.getByRole('switch', { name: 'Lugares de interés' }).click();
  await expect(page.getByText(/^12 de \d+ marcadores$/)).toBeVisible();
  await page.getByRole('button', { name: 'Listo' }).click();
  await expect(markers).toHaveCount(12);
});
