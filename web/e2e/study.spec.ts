import {expect,test} from '@playwright/test';
import {enrollTestAccount} from './passkey-helper';
async function sample(page:import('@playwright/test').Page,email:string){
 await enrollTestAccount(page,'Mobile Student',email);await page.getByRole('button',{name:'Load the sample course',exact:true}).click();await page.waitForURL(/\/courses\/[0-9a-f-]+$/,{timeout:90_000});return page.url();
}
test('phone study is resumable, has large controls and remains private',async({page,browser,request})=>{
 await page.setViewportSize({width:390,height:844});const course=await sample(page,'mobile-study@e2e.test');await page.goto(course+'/study');
 await expect(page.getByRole('heading',{name:'Make it click.'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByLabel('Round size').selectOption('2');await page.getByRole('button',{name:'Start studying',exact:true}).click();await expect(page.getByTestId('study-runner')).toBeVisible();const url=page.url();
 const reveal=page.getByRole('button',{name:'Turn card',exact:true});expect((await reveal.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await reveal.click();await page.getByRole('button',{name:'Remembered',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.reload();await expect(page.getByText('Turn 2 of')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const same=await browser.newContext({storageState:await page.context().storageState()});const resumed=await same.newPage();await resumed.goto(url);await expect(resumed.getByText('Turn 2 of')).toBeVisible();await same.close();
 const other=await browser.newContext();const student=await other.newPage();await enrollTestAccount(student,'Other learner','mobile-other@e2e.test');expect((await student.goto(url))!.status()).toBe(404);await other.close();
 const manifest=await request.get('/manifest.webmanifest');expect(manifest.status()).toBe(200);expect((await manifest.json()).display).toBe('standalone');
});
test('a full mixed round offers different angles and an honest recap',async({page})=>{
 await page.setViewportSize({width:390,height:844});const course=await sample(page,'mobile-round@e2e.test');await page.goto(course+'/study');await page.getByLabel('Round size').selectOption('2');await page.getByRole('button',{name:'Start studying',exact:true}).click();
 const angles=new Set<string>();
 for(let n=0;n<24;n++){
  if(await page.getByRole('heading',{name:'Round complete.',exact:true}).count())break;
  angles.add(await page.locator('.study-angle-chip').innerText());
  if(await page.getByRole('button',{name:'Turn card',exact:true}).count()){await page.getByRole('button',{name:'Turn card',exact:true}).click();await page.getByRole('button',{name:'Remembered',exact:true}).click();}
  else {if(await page.getByLabel('Your answer',{exact:true}).count())await page.getByLabel('Your answer',{exact:true}).fill('1');else await page.getByRole('group',{name:'Answer choices'}).getByRole('button').first().click();await page.getByRole('button',{name:'Check answer',exact:true}).click();}
  await expect(page.getByRole('button',{name:/^(Continue|See round recap)$/})).toBeVisible();await page.getByRole('button',{name:/^(Continue|See round recap)$/}).click();
 }
 await expect(page.getByRole('heading',{name:'Round complete.',exact:true})).toBeVisible();expect(angles).toEqual(new Set(['Recall it','Recognize it','Explain it','Apply it']));await expect(page.getByText('Self-rated remembered',{exact:true})).toBeVisible();await expect(page.getByText('Question answers correct',{exact:true})).toBeVisible();
});
test('a failed mobile save is visible and can be retried',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});const course=await sample(page,'mobile-network@e2e.test');await page.goto(course+'/study');await page.getByRole('radio',{name:/Flashcards/}).check();await page.getByRole('button',{name:'Start studying',exact:true}).click();await expect(page.getByRole('button',{name:'Turn card',exact:true})).toBeVisible();
 await context.setOffline(true);await page.getByRole('button',{name:'Turn card',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Could not confirm that save');await context.setOffline(false);await page.getByRole('button',{name:'Turn card',exact:true}).click();await expect(page.getByRole('button',{name:'Remembered',exact:true})).toBeVisible();
});
