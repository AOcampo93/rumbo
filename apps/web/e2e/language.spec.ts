import { expect, test } from '@playwright/test';
import { until, visible } from './helpers.ts';

// ADR 0001 / PROJECT_PLAN §14.2: the language is picked once on the first
// launch, survives a reload, and switches live in Settings mid-run, without
// reloading and without touching the run (all navigation below is in-app).

test('pick PT on the first launch, then switch to EN mid-run from Settings', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome$/);
  await page.getByRole('radio', { name: /Português/ }).click();
  await expect(page.getByRole('heading', { name: 'Escolhe o teu idioma' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-PT');
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expect(page.getByRole('heading', { name: 'Escolhe uma rota' })).toBeVisible();
  await page.getByRole('button', { name: 'Saltar' }).click();
  await page.getByRole('button', { name: 'Não, obrigado' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.reload();
  await expect(page.getByRole('link', { name: 'As minhas rotas' })).toBeVisible();

  // Simulation on, then a run with one point visited.
  await page.getByRole('link', { name: 'Definições' }).click();
  await page.getByRole('switch', { name: 'Modo de simulação' }).click();
  await page.getByRole('link', { name: 'Explorar' }).click();
  await page.getByRole('link', { name: /Leiria histórica/ }).click();
  await page.getByRole('button', { name: 'Iniciar rota' }).click();
  await page.getByRole('button', { name: 'Começar', exact: true }).click();
  await expect(page).toHaveURL(/\/run$/);
  const panel = page.getByRole('region', { name: 'Simulação' });
  await page.getByRole('button', { name: 'Simulação' }).click();
  await panel.getByRole('radio', { name: '20×' }).click();
  await page.getByRole('button', { name: 'Caminhar até ao ponto seguinte' }).click();
  const proceed = page.getByRole('button', { name: 'Continuar rota' });
  await until(page, visible(proceed), 600, 2);
  await proceed.click();
  await expect(page.getByText('1 de 12', { exact: true })).toBeVisible();

  // Leave the map (the run stays active), go to Settings and change language.
  await page.goBack();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.getByRole('button', { name: 'Voltar' }).click();
  await page.getByRole('link', { name: 'Definições' }).click();
  await page.getByRole('radio', { name: /English/ }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');

  // Back to the run: same progress, now in English.
  await page.getByRole('link', { name: 'Back to the route' }).click();
  await expect(page).toHaveURL(/\/run$/);
  await expect(page.getByText('1 of 12', { exact: true })).toBeVisible();
  await expect(page.getByText(/Nearest/i).first()).toBeVisible();
});
