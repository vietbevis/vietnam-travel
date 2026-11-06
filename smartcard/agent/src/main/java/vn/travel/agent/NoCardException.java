package vn.travel.agent;

/** Không có đầu đọc hoặc không có thẻ (ánh xạ sang HTTP 503 no-card). */
public class NoCardException extends Exception {
    public NoCardException(String message) {
        super(message);
    }

    public NoCardException(String message, Throwable cause) {
        super(message, cause);
    }
}
