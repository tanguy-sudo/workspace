import { Routes } from '@angular/router';
import { JournalComponent } from './features/journal/journal.component';
import { RhComponent } from './features/rh/rh.component';
import { SnippetsComponent } from './features/snippets/snippets.component';
import { SettingsComponent } from './features/settings/settings.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', loadComponent: () => import('./features/dashboard/dashboard.component').then(({ DashboardComponent }) => DashboardComponent), data: { title: 'Dashboard', legacyUrl: 'index.html' } },
  { path: 'rh', component: RhComponent, data: { title: 'RH', legacyUrl: 'rh.html' } },
  { path: 'projects', loadComponent: () => import('./features/projects/projects.component').then(({ ProjectsComponent }) => ProjectsComponent), data: { title: 'Projects', legacyUrl: 'projects.html' } },
  { path: 'project', pathMatch: 'full', redirectTo: 'projects' },
  { path: 'project/:id', loadComponent: () => import('./features/project-detail/project-detail.component').then(({ ProjectDetailComponent }) => ProjectDetailComponent), data: { title: 'Project', legacyUrl: 'project.html?id=<id>' } },
  { path: 'todos', loadComponent: () => import('./features/todos/todos.component').then(({ TodosComponent }) => TodosComponent), data: { title: 'Tasks', legacyUrl: 'todos.html' } },
  { path: 'snippets', component: SnippetsComponent, data: { title: 'Snippets', legacyUrl: 'snippets.html' } },
  { path: 'journal', component: JournalComponent, data: { title: 'Journal', legacyUrl: 'journal.html' } },
  { path: 'export', loadComponent: () => import('./features/export/export.component').then(({ ExportComponent }) => ExportComponent), data: { title: 'Export', legacyUrl: 'export.html' } },
  { path: 'smart-planning', loadComponent: () => import('./features/smart-planning/smart-planning.component').then(({ SmartPlanningComponent }) => SmartPlanningComponent), data: { title: 'Planning', legacyUrl: 'smart-planning.html' } },
  { path: 'settings', component: SettingsComponent, data: { title: 'Settings', legacyUrl: 'settings.html' } },
  { path: '**', redirectTo: 'home' },
];
