import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./live',fullyParallel:false,workers:1,retries:0,reporter:[['list']],use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:5173',viewport:{width:1728,height:1280},trace:'off',screenshot:'only-on-failure'},timeout:60000});
