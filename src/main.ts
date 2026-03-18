import 'zone.js';
import { registerLocaleData } from '@angular/common';
import localeEnPh from '@angular/common/locales/en-PH';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

registerLocaleData(localeEnPh);

bootstrapApplication(AppComponent, appConfig).catch(err => console.error(err));
