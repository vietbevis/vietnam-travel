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
        server.start();
        Runtime.getRuntime().addShutdownHook(new Thread(server::stop));
        System.out.println("Card Agent listening on http://127.0.0.1:" + server.boundPort() + " (mode=" + cfg.mode() + ")");
    }
}
