import { expect, test } from '@playwright/test';
import {
  fixture,
  openSimulation,
  setup,
  startRoute,
  until,
  visible,
  walkAndVisit,
} from './helpers.ts';

// PROJECT_PLAN §14.2, the run: the curated route end to end, a challenge out
// of order, deviation → pause → resume, cancelling and a reload mid-run.

test('walks "Leiria histórica" in simulation, card by card, to the summary', async ({ page }) => {
  await setup(page);
  await startRoute(page, 'leiria-historica');
  await openSimulation(page, '20×');
  for (let visited = 1; visited <= 11; visited++) {
    await walkAndVisit(page);
    await expect(page.getByText(`${visited} de 12`, { exact: true })).toBeVisible();
  }
  // The last card closes into the summary.
  await walkAndVisit(page);
  await until(page, async () => page.url().endsWith('/run/summary'), 30);
  await expect(page.getByRole('heading', { name: '¡Ruta completada!' })).toBeVisible();
  await expect(page.getByText('12/12')).toBeVisible();
});

test('a challenge point out of order asks first, then the route goes on in order', async ({
  page,
}) => {
  const route = fixture('e2e-fuera-de-orden');
  await setup(page, {}, [route]);
  await startRoute(page, route.spec.id);
  await openSimulation(page, '1×');
  // Checkpoint 2 lies on the way to checkpoint 1.
  await page.getByRole('button', { name: 'Caminar al siguiente punto' }).click();
  const outOfOrder = page.getByRole('heading', { name: 'Este no es el siguiente punto' });
  await until(page, visible(outOfOrder), 120);
  await expect(page.getByText('Primero tienes que pasar por Checkpoint 1.')).toBeVisible();
  await page.getByRole('button', { name: 'Ir a Checkpoint 1' }).click();

  const proceed = page.getByRole('button', { name: 'Continuar ruta' });
  await until(page, visible(proceed), 180);
  await expect(page.getByText('Llegaste · Punto 1 de 3')).toBeVisible();
  await proceed.click();
  await openSimulation(page, '5×');
  await walkAndVisit(page);
  await walkAndVisit(page);
  await until(page, async () => page.url().endsWith('/run/summary'), 30);
  await expect(page.getByRole('heading', { name: '¡Ruta completada!' })).toBeVisible();
});

test('a deviation offers to pause; resuming and walking back puts the user on the route', async ({
  page,
}) => {
  const route = fixture('e2e-desvio');
  await setup(page, {}, [route]);
  await startRoute(page, route.spec.id);
  // The simulation starts 150 m from the path: after the grace time, the sheet.
  const deviation = page.getByRole('heading', { name: 'Te alejaste de la ruta' });
  await until(page, visible(deviation), 60);
  await page.getByRole('dialog').getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'En pausa' })).toBeVisible();

  await page
    .getByRole('dialog', { name: 'En pausa' })
    .getByRole('button', { name: 'Reanudar' })
    .click();
  await expect(page.getByRole('heading', { name: 'En pausa' })).toBeHidden();
  await openSimulation(page, '1×');
  await page.getByRole('button', { name: 'Caminar al siguiente punto' }).click();
  await until(page, visible(page.getByText('¡De vuelta en la ruta!')), 180);
});

test('ending the run asks first and shows a neutral summary', async ({ page }) => {
  await setup(page);
  await startRoute(page, 'leiria-historica');
  await page.getByRole('button', { name: 'Pausar' }).click();
  await page.getByRole('button', { name: 'Terminar recorrido' }).click();
  await expect(page.getByRole('heading', { name: '¿Terminar el recorrido?' })).toBeVisible();
  await page.getByRole('button', { name: 'Terminar', exact: true }).click();
  await until(page, async () => page.url().endsWith('/run/summary'), 30);
  await expect(page.getByRole('heading', { name: 'Recorrido terminado' })).toBeVisible();
  await expect(page.getByText('0/12')).toBeVisible();
});

test('after a reload mid-run, "Continue" brings the run back, paused', async ({ page }) => {
  await setup(page);
  await startRoute(page, 'leiria-historica');
  await openSimulation(page, '20×');
  await walkAndVisit(page);
  await expect(page.getByText('1 de 12', { exact: true })).toBeVisible();
  await page.clock.runFor(3000); // the snapshot is saved every 2 s

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tienes un recorrido a medias' })).toBeVisible();
  await expect(page.getByText(/Leiria histórica · 1 de 12/)).toBeVisible();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page).toHaveURL(/\/run$/);
  await expect(page.getByRole('heading', { name: 'En pausa' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'En pausa' })
    .getByRole('button', { name: 'Reanudar' })
    .click();
  await expect(page.getByText('1 de 12', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'En pausa' })).toBeHidden();
});
