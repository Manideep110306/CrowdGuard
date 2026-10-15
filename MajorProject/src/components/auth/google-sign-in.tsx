import { useEffect, useRef, useState } from "react";

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleButtonOptions = {
  type: "standard";
  theme: "outline";
  size: "large";
  text: "continue_with";
  shape: "rectangular";
  logo_alignment: "left";
  width: number;
};

type GoogleIdentityApi = {
  accounts: {
    id: {
      initialize: (configuration: {
        client_id: string;
        callback: (
          response: GoogleCredentialResponse
        ) => void;
        auto_select?: boolean;
        use_fedcm_for_button?: boolean;
        button_auto_select?: boolean;
      }) => void;

      renderButton: (
        element: HTMLElement,
        options: GoogleButtonOptions
      ) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}

type GoogleSignInButtonProps = {
  onCredential: (credential: string) => void;
  disabled?: boolean;
};

const GOOGLE_CLIENT_ID =
  import.meta.env["VITE_GOOGLE_CLIENT_ID"] as
    | string
    | undefined;

// Keep the Google callback current when React re-renders.
let activeCredentialHandler:
  | ((credential: string) => void)
  | null = null;

let initializedClientId: string | null = null;

function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }

    const existingScript =
      document.getElementById(
        "google-identity-services"
      ) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener(
        "load",
        () => resolve(),
        { once: true }
      );

      existingScript.addEventListener(
        "error",
        () => reject(
          new Error("Google library failed to load.")
        ),
        { once: true }
      );

      return;
    }

    const script = document.createElement("script");

    script.id = "google-identity-services";
    script.src =
      "https://accounts.google.com/gsi/client";

    script.async = true;
    script.defer = true;

    script.onload = () => resolve();

    script.onerror = () => {
      reject(
        new Error("Google library failed to load.")
      );
    };

    document.head.appendChild(script);
  });
}

export function GoogleSignInButton({
  onCredential,
  disabled = false,
}: GoogleSignInButtonProps) {
  const containerRef =
    useRef<HTMLDivElement>(null);

  const [error, setError] = useState("");

  const callbackRef = useRef(onCredential);

  useEffect(() => {
    callbackRef.current = onCredential;
    activeCredentialHandler = (credential) => {
      callbackRef.current(credential);
    };
  }, [onCredential]);

  useEffect(() => {
    let cancelled = false;

    async function setupGoogleButton() {
      if (!GOOGLE_CLIENT_ID) {
        setError(
          "Google Sign-In is not configured. Check VITE_GOOGLE_CLIENT_ID."
        );
        return;
      }

      try {
        await loadGoogleScript();

        if (cancelled || !containerRef.current) {
          return;
        }

        const google = window.google;

        if (!google?.accounts?.id) {
          throw new Error(
            "Google Sign-In is unavailable."
          );
        }

        // Initialize Google's identity service once per client ID.
        if (
          initializedClientId !== GOOGLE_CLIENT_ID
        ) {
          google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,

            callback: (response) => {
              if (!response.credential) {
                setError(
                  "Google did not return an authentication credential."
                );
                return;
              }

              activeCredentialHandler?.(
                response.credential
              );
            },

            // Explicitly avoid automatic account selection.
            auto_select: false,
            button_auto_select: false,
            use_fedcm_for_button: true,
          });

          initializedClientId = GOOGLE_CLIENT_ID;
        }

        if (cancelled || !containerRef.current) {
          return;
        }

        containerRef.current.replaceChildren();

        const width = Math.max(
          240,
          Math.min(
            containerRef.current.clientWidth || 320,
            400
          )
        );

        google.accounts.id.renderButton(
          containerRef.current,
          {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "continue_with",
            shape: "rectangular",
            logo_alignment: "left",
            width,
          }
        );

        setError("");
      } catch (reason) {
        if (!cancelled) {
          console.error(
            "Google Sign-In initialization failed:",
            reason
          );

          setError(
            "Unable to load Google Sign-In. Check your connection and configuration."
          );
        }
      }
    }

    void setupGoogleButton();

    return () => {
      cancelled = true;
      containerRef.current?.replaceChildren();
    };
  }, []);

  return (
    <div className="google-signin-wrapper">
      <div
        ref={containerRef}
        aria-label="Continue with Google"
        aria-disabled={disabled}
        style={{
          display: "flex",
          justifyContent: "center",
          width: "100%",
          opacity: disabled ? 0.55 : 1,
          pointerEvents: disabled ? "none" : "auto",
        }}
      />

      {error && (
        <p
          role="alert"
          className="form-note login-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}