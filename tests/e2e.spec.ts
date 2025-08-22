import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('UI E2E Tests - Bühlmann Planner', () => {
  
  test.beforeEach(async ({ page }) => {
    // Naviguer vers l'interface en file:// local
    const htmlPath = path.join(process.cwd(), 'docs', 'index.html');
    await page.goto(`file://${htmlPath}`);
    
    // Vérifier que la page est chargée
    await expect(page.locator('h1')).toContainText('Bühlmann ZH-L16C');
  });

  test('Self-Test doit passer', async ({ page }) => {
    // Cliquer sur le bouton Self-Test
    await page.click('#selftest');
    
    // Vérifier que le test passe
    await expect(page.locator('#out')).toContainText('✅ OK');
    
    // Vérifier les détails des tests
    await expect(page.locator('#out')).toContainText('pinsp sanity: OK');
    await expect(page.locator('#out')).toContainText('Subsurface-like');
    await expect(page.locator('#out')).toContainText('Peregrine-like');
    await expect(page.locator('#out')).toContainText('Bühlmann pur');
  });

  test('Bühlmann pur - 40m/10min GF85/85 sans palier minimal', async ({ page }) => {
    // Configurer les paramètres
    await page.fill('#depth', '40');
    await page.fill('#tbt', '10');
    await page.fill('#fo2', '21');
    await page.fill('#fhe', '0');
    await page.fill('#gfl', '85');
    await page.fill('#gfh', '85');
    await page.uncheck('#last6'); // Dernier palier à 3m
    await page.fill('#minLast', '0'); // Pas de minimum
    
    // Calculer
    await page.click('#go');
    
    // Vérifier qu'il n'y a pas de palier obligatoire
    await expect(page.locator('#out')).toContainText('Aucun palier obligatoire');
    
    // Vérifier TTS entre 4 et 6 min (remontée directe depuis 40m à 9m/min)
    const ttsText = await page.locator('#out p').first().textContent();
    const tts = parseFloat(ttsText?.match(/\d+/)?.[0] || '0');
    expect(tts).toBeGreaterThanOrEqual(4);
    expect(tts).toBeLessThanOrEqual(6);
  });

  test('Bühlmann pur avec last=6m - pas de maintien artificiel', async ({ page }) => {
    // Configurer les paramètres
    await page.fill('#depth', '40');
    await page.fill('#tbt', '10');
    await page.fill('#fo2', '21');
    await page.fill('#fhe', '0');
    await page.fill('#gfl', '85');
    await page.fill('#gfh', '85');
    await page.check('#last6'); // Dernier palier à 6m
    await page.fill('#minLast', '0'); // Pas de minimum
    
    // Calculer
    await page.click('#go');
    
    // Vérifier qu'il n'y a pas de palier obligatoire ni de maintien artificiel
    await expect(page.locator('#out')).toContainText('Aucun palier obligatoire');
    
    // Vérifier TTS entre 4 et 6 min
    const ttsText = await page.locator('#out p').first().textContent();
    const tts = parseFloat(ttsText?.match(/\d+/)?.[0] || '0');
    expect(tts).toBeGreaterThanOrEqual(4);
    expect(tts).toBeLessThanOrEqual(6);
  });

  test('Subsurface-like - 40m/10min avec palier minimal 1min @ 3m', async ({ page }) => {
    // Configurer les paramètres
    await page.fill('#depth', '40');
    await page.fill('#tbt', '10');
    await page.fill('#fo2', '21');
    await page.fill('#fhe', '0');
    await page.fill('#gfl', '85');
    await page.fill('#gfh', '85');
    await page.uncheck('#last6'); // Dernier palier à 3m
    await page.fill('#minLast', '1'); // Minimum 1 minute
    
    // Calculer
    await page.click('#go');
    
    // Vérifier qu'il y a un palier
    await expect(page.locator('#out table')).toBeVisible();
    
    // Vérifier palier à 3m d'au moins 1 minute
    const stopDepth = await page.locator('#out table tbody tr:last-child td:nth-child(1)').textContent();
    const stopTime = await page.locator('#out table tbody tr:last-child td:nth-child(2)').textContent();
    
    expect(stopDepth).toBe('3');
    expect(parseFloat(stopTime || '0')).toBeGreaterThanOrEqual(1);
  });

  test('Peregrine-like - 40m/10min avec palier minimal @ 6m', async ({ page }) => {
    // Configurer les paramètres
    await page.fill('#depth', '40');
    await page.fill('#tbt', '10');
    await page.fill('#fo2', '21');
    await page.fill('#fhe', '0');
    await page.fill('#gfl', '85');
    await page.fill('#gfh', '85');
    await page.check('#last6'); // Dernier palier à 6m
    await page.fill('#minLast', '1'); // Minimum 1 minute
    
    // Calculer
    await page.click('#go');
    
    // Vérifier qu'il y a un palier
    await expect(page.locator('#out table')).toBeVisible();
    
    // Vérifier palier à 6m d'au moins 2 minutes
    const stopDepth = await page.locator('#out table tbody tr:last-child td:nth-child(1)').textContent();
    const stopTime = await page.locator('#out table tbody tr:last-child td:nth-child(2)').textContent();
    
    expect(stopDepth).toBe('6');
    expect(parseFloat(stopTime || '0')).toBeGreaterThanOrEqual(2);
  });

  test('Changement lastStopDepth 3m ⇄ 6m change le comportement', async ({ page }) => {
    // Test avec lastStopDepth = 3m
    await page.fill('#depth', '40');
    await page.fill('#tbt', '15');
    await page.fill('#fo2', '21');
    await page.fill('#fhe', '0');
    await page.fill('#gfl', '85');
    await page.fill('#gfh', '85');
    await page.uncheck('#last6');
    await page.fill('#minLast', '1');
    await page.click('#go');
    
    // Capturer le résultat à 3m
    const depth3m = await page.locator('#out table tbody tr:last-child td:nth-child(1)').textContent();
    const time3m = await page.locator('#out table tbody tr:last-child td:nth-child(2)').textContent();
    
    // Test avec lastStopDepth = 6m
    await page.check('#last6');
    await page.click('#go');
    
    // Capturer le résultat à 6m
    const depth6m = await page.locator('#out table tbody tr:last-child td:nth-child(1)').textContent();
    const time6m = await page.locator('#out table tbody tr:last-child td:nth-child(2)').textContent();
    
    // Vérifications
    expect(depth3m).toBe('3');
    expect(depth6m).toBe('6');
    expect(parseFloat(time6m || '0')).toBeGreaterThan(parseFloat(time3m || '0'));
  });

  test('Graphique de profil est affiché', async ({ page }) => {
    // Configurer un profil simple
    await page.fill('#depth', '30');
    await page.fill('#tbt', '15');
    
    // Calculer
    await page.click('#go');
    
    // Vérifier que le canvas du graphique est visible
    await expect(page.locator('#profileChart')).toBeVisible();
    
    // Vérifier que le canvas a du contenu (non vide)
    const canvas = page.locator('#profileChart');
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(100);
    expect(box?.height).toBeGreaterThan(100);
  });

  test('Validation des entrées - Trimix', async ({ page }) => {
    // Configurer un mélange Trimix
    await page.fill('#depth', '60');
    await page.fill('#tbt', '20');
    await page.fill('#fo2', '18');
    await page.fill('#fhe', '45');
    await page.fill('#gfl', '30');
    await page.fill('#gfh', '85');
    
    // Calculer
    await page.click('#go');
    
    // Vérifier que le calcul fonctionne (pas d'erreur)
    await expect(page.locator('#out')).toBeVisible();
    await expect(page.locator('#out')).toContainText('TTS');
  });

  test('Plongée avec paliers obligatoires - 40m/30min', async ({ page }) => {
    // Configurer une plongée nécessitant des paliers
    await page.fill('#depth', '40');
    await page.fill('#tbt', '30');
    await page.fill('#fo2', '21');
    await page.fill('#fhe', '0');
    await page.fill('#gfl', '85');
    await page.fill('#gfh', '85');
    await page.uncheck('#last6');
    await page.fill('#minLast', '0');
    
    // Calculer
    await page.click('#go');
    
    // Vérifier qu'il y a des paliers
    await expect(page.locator('#out table')).toBeVisible();
    const rows = await page.locator('#out table tbody tr').count();
    expect(rows).toBeGreaterThan(0);
    
    // Vérifier que TOUS les paliers sont en multiples de 3m
    for (let i = 0; i < rows; i++) {
      const depth = await page.locator(`#out table tbody tr:nth-child(${i + 1}) td:nth-child(1)`).textContent();
      const depthNum = parseInt(depth || '0');
      expect(depthNum % 3).toBe(0);
      expect(depthNum).toBeGreaterThan(0); // Pas de palier à 0m
    }
    
    // Vérifier TTS > 30 min
    const ttsText = await page.locator('#out p').first().textContent();
    const tts = parseFloat(ttsText?.match(/\d+/)?.[0] || '0');
    expect(tts).toBeGreaterThan(30);
  });

  test('Gradient Factors - Deep stops', async ({ page }) => {
    // Configurer avec GF low/high différents
    await page.fill('#depth', '40');
    await page.fill('#tbt', '20');
    await page.fill('#fo2', '21');
    await page.fill('#fhe', '0');
    await page.fill('#gfl', '30'); // GF low
    await page.fill('#gfh', '85'); // GF high
    
    // Calculer
    await page.click('#go');
    
    // Vérifier qu'il y a des paliers
    await expect(page.locator('#out table')).toBeVisible();
    
    // Vérifier que le GF du dernier palier est proche de GF high
    const lastRow = page.locator('#out table tbody tr:last-child');
    const gfText = await lastRow.locator('td:nth-child(3)').textContent();
    const gf = parseInt(gfText?.replace('%', '') || '0');
    
    // Le GF au dernier palier devrait être entre 70% et 85%
    expect(gf).toBeGreaterThan(70);
    expect(gf).toBeLessThanOrEqual(85);
  });

  test('Arrondi du TTS à la minute entière dans l\'UI', async ({ page }) => {
    // Configurer un profil qui donne un TTS avec décimales
    await page.fill('#depth', '25');
    await page.fill('#tbt', '12');
    await page.fill('#fo2', '21');
    await page.fill('#fhe', '0');
    await page.fill('#gfl', '85');
    await page.fill('#gfh', '85');
    await page.uncheck('#last6');
    await page.fill('#minLast', '0');
    
    // Calculer
    await page.click('#go');
    
    // Vérifier que le TTS affiché est un entier (pas de décimales)
    const ttsText = await page.locator('#out p').first().textContent();
    const ttsMatch = ttsText?.match(/TTS\s*:\s*(\d+)\s*min/);
    expect(ttsMatch).toBeTruthy();
    
    // Vérifier qu'il n'y a pas de décimales dans l'affichage
    expect(ttsText).not.toContain('.');
    expect(ttsText).toMatch(/\d+\s*min/);
  });
});