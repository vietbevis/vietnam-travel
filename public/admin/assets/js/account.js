// Đăng nhập vẫn dùng được HTML validation khi CDN tuỳ chọn không tải được.
const loginForm = document.querySelector('#login-form');
if (loginForm) {
  const status = document.querySelector('[card-login-status]');
  const button = loginForm.querySelector('button[type="submit"]');
  let busy = false;
  const message = text => { if (status) status.textContent = text; else alert(text); };
  async function submitLogin(event) {
    event.preventDefault();
    if (busy) return;
    if (!loginForm.checkValidity()) { loginForm.reportValidity(); return; }
    busy = true; if (button) button.disabled = true; message('Đang xác thực…');
    try {
      const response = await fetch(`/${pathAdmin}/account/login`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({email:loginForm.email.value,password:loginForm.password.value,rememberPassword:loginForm.rememberPassword.checked})
      });
      loginForm.password.value = '';
      const result = await response.json();
      if (!response.ok || result.code === 'error') throw new Error(result.message || 'Không thể đăng nhập.');
      if (result.code === 'card-required') {
        const client = window.cardClient;
        if (!client) throw new Error('Không kết nối được Card Agent.');
        const info = await client.openSession();
        if (info.state === 0) throw new Error('Thẻ chưa được phát hành. Hãy cắm thẻ nhân viên đã kích hoạt.');
        if (info.state !== 2 || info.cardType !== 2) throw new Error('Thẻ nhân viên không hợp lệ hoặc đã bị khoá/thu hồi.');
        let pin, newPin, confirmation;
        try {
          pin = await client.askPin(info.mustChangePin ? 'Nhập PIN ban đầu của thẻ nhân viên' : 'Nhập PIN thẻ nhân viên');
          await client.verifyPin(pin);
          if (info.mustChangePin) {
            newPin = await client.askPin('Đặt PIN mới (không dùng mã yếu hoặc ngày sinh)');
            confirmation = await client.askPin('Nhập lại PIN mới');
            if (newPin !== confirmation) throw new Error('PIN xác nhận không khớp. Hãy thử đăng nhập lại.');
            await client.changePin(pin, newPin);
            await client.verifyPin(newPin);
          }
        } finally { pin = ''; newPin = ''; confirmation = ''; }
        const verified = await client.authenticate({challengeUrl:`/${pathAdmin}/account/login-card/challenge`,verifyUrl:`/${pathAdmin}/account/login-card/verify`});
        if (verified.code !== 'success') throw new Error(verified.message || 'Không thể xác thực thẻ nhân viên.');
      } else if (result.code !== 'success') throw new Error('Phản hồi đăng nhập không hợp lệ.');
      window.location.href = `/${pathAdmin}/dashboard`;
    } catch (error) {
      const fallback = {
        PIN_CANCELLED:'Đã huỷ nhập PIN.',
        WEAK_PIN:'PIN mới quá yếu. Hãy chọn mã khác rồi đăng nhập lại.',
        CARD_AUTH_INVALID:'Thẻ không hợp lệ hoặc yêu cầu xác thực đã hết hạn. Hãy thử lại.',
        AUTH_REQUIRED:'Phiên xác thực hết hạn. Hãy đăng nhập lại.',
        AGENT_HTTP:'Card Agent chưa sẵn sàng hoặc khe đọc không có thẻ.',
        CARD_RESPONSE:'Không đọc được thẻ. Hãy kiểm tra khe đọc.',
        OP_FORBIDDEN:'Thẻ không được phép đăng nhập tài khoản này.'
      };
      message(fallback[error.code] || error.message || 'Không thể đăng nhập. Hãy kiểm tra Card Agent và thẻ.');
    } finally {
      loginForm.password.value = ''; busy = false; if (button) button.disabled = false;
    }
  }
  loginForm.addEventListener('submit', submitLogin);
}
// End Login Form

// Register Form
const registerForm = document.querySelector("#register-form");
if(registerForm) {
  const validation = new JustValidate('#register-form');

  validation
    .addField('#fullName', [
      {
        rule: 'required',
        errorMessage: 'Vui lòng nhập họ tên!'
      },
      {
        rule: 'minLength',
        value: 5,
        errorMessage: 'Họ tên phải có ít nhất 5 ký tự!',
      },
      {
        rule: 'maxLength',
        value: 50,
        errorMessage: 'Họ tên không được vượt quá 50 ký tự!',
      },
    ])
    .addField('#email', [
      {
        rule: 'required',
        errorMessage: 'Vui lòng nhập email của bạn!',
      },
      {
        rule: 'email',
        errorMessage: 'Email không đúng định dạng!',
      },
    ])
    .addField('#password', [
      {
        rule: 'required',
        errorMessage: 'Vui lòng nhập mật khẩu!',
      },
      {
        validator: (value) => value.length >= 8,
        errorMessage: 'Mật khẩu phải chứa ít nhất 8 ký tự!',
      },
      {
        validator: (value) => /[A-Z]/.test(value),
        errorMessage: 'Mật khẩu phải chứa ít nhất một chữ cái in hoa!',
      },
      {
        validator: (value) => /[a-z]/.test(value),
        errorMessage: 'Mật khẩu phải chứa ít nhất một chữ cái thường!',
      },
      {
        validator: (value) => /\d/.test(value),
        errorMessage: 'Mật khẩu phải chứa ít nhất một chữ số!',
      },
      {
        validator: (value) => /[@$!%*?&]/.test(value),
        errorMessage: 'Mật khẩu phải chứa ít nhất một ký tự đặc biệt!',
      },
    ])
    .addField('#agree', [
      {
        rule: 'required',
        errorMessage: 'Bạn phải đồng ý với các điều khoản và điều kiện!',
      },
    ])
    .onSuccess((event) => {
      const fullName = event.target.fullName.value;
      const email = event.target.email.value;
      const password = event.target.password.value;

      const dataFinal = {
        fullName: fullName,
        email: email,
        password: password
      };

      fetch(`/${pathAdmin}/account/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(dataFinal)
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            alert(data.message);
          }

          if(data.code == "success") {
            window.location.href = `/${pathAdmin}/account/register-initial`;
          }
        })
    })
  ;
}
// End Register Form

// Forgot Password Form
const forgotPasswordForm = document.querySelector("#forgot-password-form");
if(forgotPasswordForm) {
  const validation = new JustValidate('#forgot-password-form');

  validation
    .addField('#email', [
      {
        rule: 'required',
        errorMessage: 'Vui lòng nhập email của bạn!',
      },
      {
        rule: 'email',
        errorMessage: 'Email không đúng định dạng!',
      },
    ])
    .onSuccess((event) => {
      const email = event.target.email.value;
      
      const dataFinal = {
        email: email,
      };

      fetch(`/${pathAdmin}/account/forgot-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dataFinal),
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            alert(data.message);
          }

          if(data.code == "success") {
            window.location.href = `/${pathAdmin}/account/otp-password?email=${email}`;
          }
        })
    })
  ;
}
// End Forgot Password Form

// OTP Password Form
const otpPasswordForm = document.querySelector("#otp-password-form");
if(otpPasswordForm) {
  const validation = new JustValidate('#otp-password-form');

  validation
    .addField('#otp', [
      {
        rule: 'required',
        errorMessage: 'Vui lòng nhập mã OTP!',
      },
    ])
    .onSuccess((event) => {
      const otp = event.target.otp.value;
      
      const urlParams = new URLSearchParams(window.location.search);
      const email = urlParams.get("email");

      const dataFinal = {
        otp: otp,
        email: email
      }

      fetch(`/${pathAdmin}/account/otp-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dataFinal),
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            alert(data.message);
          }

          if(data.code == "success") {
            window.location.href = `/${pathAdmin}/account/reset-password`;
          }
        })
    })
  ;
}
// End OTP Password Form

// Reset Password Form
const resetPasswordForm = document.querySelector("#reset-password-form");
if(resetPasswordForm) {
  const validation = new JustValidate('#reset-password-form');

  validation
    .addField('#password', [
      {
        rule: 'required',
        errorMessage: 'Vui lòng nhập mật khẩu!',
      },
      {
        validator: (value) => value.length >= 8,
        errorMessage: 'Mật khẩu phải chứa ít nhất 8 ký tự!',
      },
      {
        validator: (value) => /[A-Z]/.test(value),
        errorMessage: 'Mật khẩu phải chứa ít nhất một chữ cái in hoa!',
      },
      {
        validator: (value) => /[a-z]/.test(value),
        errorMessage: 'Mật khẩu phải chứa ít nhất một chữ cái thường!',
      },
      {
        validator: (value) => /\d/.test(value),
        errorMessage: 'Mật khẩu phải chứa ít nhất một chữ số!',
      },
      {
        validator: (value) => /[@$!%*?&]/.test(value),
        errorMessage: 'Mật khẩu phải chứa ít nhất một ký tự đặc biệt!',
      },
    ])
    .addField('#confirm-password', [
      {
        rule: 'required',
        errorMessage: 'Vui lòng xác nhận mật khẩu!',
      },
      {
        validator: (value, fields) => {
          const password = fields['#password'].elem.value;
          return value == password;
        },
        errorMessage: 'Mật khẩu xác nhận không khớp!',
      }
    ])
    .onSuccess((event) => {
      const password = event.target.password.value;
      
      const dataFinal = {
        password: password
      };

      fetch(`/${pathAdmin}/account/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dataFinal),
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            alert(data.message);
          }

          if(data.code == "success") {
            window.location.href = data.requiresLogin ? `/${pathAdmin}/account/login` : `/${pathAdmin}/dashboard`;
          }
        })
    })
  ;
}
// End Reset Password Form
