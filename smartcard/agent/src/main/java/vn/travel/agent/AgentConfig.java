package vn.travel.agent;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.Properties;
import java.util.Set;

/**
 * Cấu hình của agent.
 *
 * @param port           cổng lắng nghe trên 127.0.0.1 (0 để HĐH tự chọn, chỉ dùng trong test)
 * @param allowedOrigins các Origin được phép gọi (so khớp chính xác)
 * @param mode           "sim" hoặc "pcsc"
 * @param reader         tên đầu đọc PC/SC (tùy chọn, có thể null hoặc rỗng)
 */
public record AgentConfig(int port, Set<String> allowedOrigins, String mode, String reader) {
    public static final int DEFAULT_PORT = 31999;

    /**
     * Đọc cấu hình từ file properties (có thể không tồn tại) rồi áp dụng tham số dòng lệnh:
     * {@code --sim} ghi đè {@code mode}, {@code --port=N} ghi đè {@code port}.
     */
    public static AgentConfig load(Path propertiesFile, String[] args) {
        Properties p = new Properties();
        if (propertiesFile != null && Files.isRegularFile(propertiesFile)) {
            try (InputStream in = Files.newInputStream(propertiesFile)) {
                p.load(in);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
        int port = Integer.parseInt(p.getProperty("port", String.valueOf(DEFAULT_PORT)).trim());
        String mode = p.getProperty("mode", "pcsc").trim();
        String reader = p.getProperty("reader", "").trim();
        Set<String> origins = new LinkedHashSet<>();
        for (String o : p.getProperty("allowedOrigins", "").split(",")) {
            if (!o.trim().isEmpty()) {
                origins.add(o.trim());
            }
        }
        if (args != null) {
            for (String a : args) {
                if (a.equals("--sim")) {
                    mode = "sim";
                } else if (a.startsWith("--port=")) {
                    port = Integer.parseInt(a.substring("--port=".length()).trim());
                }
            }
        }
        return new AgentConfig(port, Set.copyOf(origins), mode, reader.isEmpty() ? null : reader);
    }
}
