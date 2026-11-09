import { expect, test } from '@playwright/test';

test('dropped ER files keep independent tabs and new diagrams start empty', async ({ page }) => {
  await page.addInitScript(() => {
    window.invoke = async (raw: string) => {
      const { method, params } = JSON.parse(raw);
      let data = {};
      if (method === 'parseERDiagram') {
        const { content } = JSON.parse(params);
        if (!content.startsWith('# A5:ER')) {
          return JSON.stringify({ success: false, error: 'Invalid ER file' });
        }
        const name = content.match(/^PName=(.+)$/m)?.[1];
        data = {
          name: 'Main',
          databaseType: '',
          ddl: '',
          relations: [],
          // Converted IPC colors; C++ parser tests cover A5ER byte order separately.
          shapes: [
            {
              shapeType: 'rect',
              text: 'Synthetic group',
              page: 'Main',
              fillColor: '#18a2f0',
              fontColor: '#eeeeee',
              fillAlpha: 128,
              fontSize: 12,
              left: 0,
              top: 200,
              width: 300,
              height: 120,
            },
          ],
          tables: [
            {
              name,
              logicalName: '',
              comment: '',
              columns: [],
              indexes: [],
              page: 'Main',
              posX: 0,
              posY: 0,
              color: '#1e1e1e',
              bkColor: '#767676',
            },
          ],
        };
      }
      return JSON.stringify({ success: true, data });
    };
  });
  await page.goto('/');
  await expect(page.getByTitle('新規タブ (Ctrl+N)')).toBeVisible();
  const drop = (filename: string, content: string) =>
    page.evaluate(
      ({ filename, content }) => {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File([content], filename));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer, cancelable: true }));
      },
      { filename, content }
    );
  const fixture = (table: string) => `# A5:ER FORMAT:19\n[Entity]\nPName=${table}\nPage=Main\n`;
  const tables = page.locator('.react-flow__node-table');
  await drop('first.A5ER', fixture('FirstTable'));
  await expect(tables).toHaveAttribute('data-id', 'FirstTable');
  const header = tables.getByText('FirstTable', { exact: true }).locator('..');
  await expect(header).toHaveCSS('background-color', 'rgb(118, 118, 118)');
  await expect(header).toHaveCSS('color', 'rgb(255, 255, 255)');
  const shape = page.locator('.react-flow__node-shape > div');
  await expect(shape).toHaveCSS('background-color', 'rgba(24, 162, 240, 0.502)');
  await expect(shape).toHaveCSS('color', 'rgb(238, 238, 238)');
  await drop('second.a5er', fixture('SecondTable'));
  await expect(tables).toHaveAttribute('data-id', 'SecondTable');
  await page.getByText('first.A5ER', { exact: true }).click();
  await expect(tables).toHaveAttribute('data-id', 'FirstTable');
  await page.getByTitle('新規タブ (Ctrl+N)').click();
  await page.getByRole('button', { name: '新規ER図' }).click();
  await expect(page.getByRole('button', { name: 'ER図ファイルを読み込む' })).toBeVisible();
  await page
    .getByRole('tab', { name: /first.A5ER/ })
    .getByTitle('タブを閉じる')
    .click();
  await expect(page.getByRole('tab', { name: /first.A5ER/ })).toHaveCount(0);
  await drop('invalid.a5er', 'broken');
  await expect(page.getByText(/Invalid ER file/)).toBeVisible();
  await expect(tables).toHaveCount(0);
  await drop('first.A5ER', fixture('UpdatedTable'));
  await expect(tables).toHaveAttribute('data-id', 'UpdatedTable');
  await page.getByRole('tab', { name: /second.a5er/ }).click();
  await expect(tables).toHaveAttribute('data-id', 'SecondTable');
});
