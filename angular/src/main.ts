import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

try {
  document.documentElement.setAttribute('data-theme', localStorage.getItem('workspace-theme') || 'dark');
} catch {
  document.documentElement.setAttribute('data-theme', 'dark');
}

bootstrapApplication(App, appConfig)
  .catch(() => console.error('Workspace application failed to start'));
