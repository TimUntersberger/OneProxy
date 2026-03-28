import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

declare global {
  interface Window {
    google?: GoogleNamespace;
  }
}

export interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  prompt?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleOauth2Namespace {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type: string }) => void;
  }) => GoogleTokenClient;
}

interface GoogleNamespace {
  accounts: {
    oauth2: GoogleOauth2Namespace;
  };
}

@Injectable({ providedIn: 'root' })
export class GoogleIdentityService {
  private readonly document = inject(DOCUMENT);
  private loadPromise: Promise<GoogleOauth2Namespace> | null = null;

  loadOauth2(): Promise<GoogleOauth2Namespace> {
    if (window.google?.accounts?.oauth2) {
      return Promise.resolve(window.google.accounts.oauth2);
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = new Promise<GoogleOauth2Namespace>((resolve, reject) => {
      const existingScript = this.document.querySelector<HTMLScriptElement>(
        'script[data-google-identity="gsi-client"]',
      );

      if (existingScript) {
        existingScript.addEventListener('load', handleLoad, { once: true });
        existingScript.addEventListener('error', handleError, { once: true });
        return;
      }

      const script = this.document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset['googleIdentity'] = 'gsi-client';
      script.addEventListener('load', handleLoad, { once: true });
      script.addEventListener('error', handleError, { once: true });
      this.document.head.appendChild(script);

      function handleLoad(): void {
        if (window.google?.accounts?.oauth2) {
          resolve(window.google.accounts.oauth2);
          return;
        }

        reject(new Error('Google Identity Services loaded but OAuth client was unavailable.'));
      }

      function handleError(): void {
        reject(new Error('Failed to load Google Identity Services.'));
      }
    }).catch((error) => {
      this.loadPromise = null;
      throw error;
    });

    return this.loadPromise;
  }
}
