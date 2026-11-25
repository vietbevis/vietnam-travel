const showTravelNotice = (message, icon = "warning") => {
  if (!window.Swal) return window.alert(message);
  return Swal.fire({
    icon,
    title: icon === "warning" ? "Thông báo" : "Kết quả",
    text: message,
    confirmButtonText: "Đã hiểu",
    confirmButtonColor: "#2563eb",
    heightAuto: false
  });
};
