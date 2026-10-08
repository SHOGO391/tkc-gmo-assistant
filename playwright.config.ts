import { defineConfig } from 'playwright/test';
export default defineConfig({testDir:'./tests/browser',workers:1,use:{baseURL:'http://127.0.0.1:4319',headless:true,screenshot:'only-on-failure'},reporter:'list',webServer:{command:'npm run dev',url:'http://127.0.0.1:4319',reuseExistingServer:false,env:{PORT:'4319',DATA_DIR:'test-results/e2e-data'}},outputDir:'test-results/browser'});
