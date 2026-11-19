import {expect,test} from '@playwright/test';
import {enrollTestAccount} from './passkey-helper';
test('course ZIP requires the owner and is linked from Materials',async({page,request,browser})=>{
 expect((await request.get('/api/courses/00000000-0000-0000-0000-000000000000/export')).status()).toBe(401);
 await enrollTestAccount(page,'Export Student','export@e2e.test');await page.getByRole('button',{name:'Load the sample course',exact:true}).click();await page.waitForURL(/\/courses\/[0-9a-f-]+$/,{timeout:90_000});const course=page.url();const id=course.split('/').pop()!;
 await page.goto(course+'/materials');await expect(page.getByRole('link',{name:'Download course ZIP',exact:true})).toHaveAttribute('href',`/api/courses/${id}/export`);
 const archive=await page.request.get(`/api/courses/${id}/export`);expect(archive.status()).toBe(200);expect(archive.headers()['content-type']).toBe('application/zip');expect(archive.headers()['cache-control']).toContain('no-store');expect((await archive.body()).subarray(0,2).toString()).toBe('PK');
 const other=await browser.newContext();const student=await other.newPage();await enrollTestAccount(student,'Another Student','export-other@e2e.test');expect((await student.request.get(`/api/courses/${id}/export`)).status()).toBe(404);await other.close();
});
