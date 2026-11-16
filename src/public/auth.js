document.addEventListener('DOMContentLoaded', () => {
  const page = window.location.pathname;
  if (['/admin-login.html', '/admin-setup.html', '/login.html', '/register.html'].includes(page)) {
    fetch('/api/auth/status')
      .then(async (response) => {
        if (!response.ok) return;
        const status = await response.json();
        if (status.authenticated) {
          window.location.replace('/');
        } else if (!status.setupComplete && !status.hasUsers && page === '/admin-login.html') {
          window.location.replace('/admin-setup.html');
        } else if (status.setupComplete && page === '/admin-setup.html') {
          window.location.replace('/admin-login.html');
        }
      })
      .catch(() => {});
  }

  document.querySelectorAll('.password-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const input = toggle.parentElement.querySelector('input');
      const isVisible = input.type === 'text';
      input.type = isVisible ? 'password' : 'text';
      toggle.textContent = isVisible ? 'Show' : 'Hide';
      toggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
      toggle.setAttribute('aria-pressed', String(!isVisible));
    });
  });

  document.querySelectorAll('[data-auth-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = form.querySelector('.form-message');
      const password = form.elements.password;
      const confirmation = form.elements.confirmPassword;

      form.querySelectorAll('input').forEach((input) => {
        input.removeAttribute('aria-invalid');
      });
      if (confirmation) confirmation.setCustomValidity('');
      message.classList.remove('is-visible');
      message.textContent = '';

      if (!form.checkValidity()) {
        const invalidInput = form.querySelector(':invalid');
        if (invalidInput) {
          invalidInput.setAttribute('aria-invalid', 'true');
          invalidInput.focus();
        }
        form.reportValidity();
        return;
      }

      if (confirmation && password.value !== confirmation.value) {
        confirmation.setAttribute('aria-invalid', 'true');
        confirmation.setCustomValidity('Passwords do not match.');
        confirmation.reportValidity();
        confirmation.focus();
        return;
      }

      const formType = form.dataset.authForm;
      let endpoint = '/api/auth/login';
      let payload = {};

      if (formType === 'register') {
        endpoint = '/api/auth/register';
        payload = {
          name: form.elements.name ? form.elements.name.value.trim() : '',
          email: form.elements.email ? form.elements.email.value.trim() : '',
          password: password.value
        };
      } else if (formType === 'user-login') {
        endpoint = '/api/auth/login';
        payload = {
          email: form.elements.email ? form.elements.email.value.trim() : '',
          password: password.value
        };
      } else if (formType === 'admin-setup') {
        endpoint = '/api/auth/setup';
        payload = {
          loginId: form.elements.loginId ? form.elements.loginId.value.trim() : '',
          password: password.value
        };
      } else if (formType === 'admin-login') {
        endpoint = '/api/auth/login';
        payload = {
          loginId: form.elements.loginId ? form.elements.loginId.value.trim() : '',
          password: password.value
        };
      }

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) {
          message.textContent = result.error || 'Unable to authenticate.';
          message.classList.add('is-visible');
          return;
        }
        window.location.assign('/');
      } catch {
        message.textContent = 'Could not reach LAN Monitor. Check that the local server is running and try again.';
        message.classList.add('is-visible');
      }
    });
  });
});

function showPageError(message) {
  const status = document.querySelector('.form-message');
  if (status) {
    status.textContent = message;
    status.classList.add('is-visible');
  }
}
