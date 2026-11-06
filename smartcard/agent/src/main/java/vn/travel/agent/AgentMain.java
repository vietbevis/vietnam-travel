package vn.travel.agent;

import java.nio.file.Path;

/** Điểm vào của Card Agent: đọc cấu hình, tạo cổng thẻ theo chế độ và mở cầu HTTP. */
public final class AgentMain {
    private AgentMain() {}

    public static void main(String[] args) throws Exception {
        AgentConfig cfg;
        try {
            cfg = AgentConfig.load(Path.of("agent.properties"), args);
        } catch (IllegalArgumentException e) {
            System.err.println(e.getMessage());
            System.exit(2);
            return;
        }
        CardPort port = switch (cfg.mode()) {
            case "sim" -> new SimCardPort(4);
            case "pcsc" -> new PcscCardPort(cfg.reader());
            default -> {
                System.err.println("Chế độ không hợp lệ: '" + cfg.mode() + "' (chỉ nhận sim hoặc pcsc)");
                System.exit(2);
                yield null;
            }
        };
        AgentHttpServer server = new AgentHttpServer(cfg, port);
        try {
            server.start();
        } catch (java.net.BindException e) {
            System.err.println("Không mở được cổng " + cfg.port() + " (đang bị chiếm). Đổi cổng bằng --port=N"
                    + " hoặc tắt tiến trình đang dùng cổng này.");
            System.exit(1);
            return;
        }
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.stop();
            if (port instanceof PcscCardPort pcsc) {
                pcsc.close();
            }
        }));
        System.out.println("Card Agent listening on http://127.0.0.1:" + server.boundPort() + " (mode=" + cfg.mode() + ")");
    }
}
