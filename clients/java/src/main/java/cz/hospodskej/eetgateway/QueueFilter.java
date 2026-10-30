package cz.hospodskej.eetgateway;

import java.util.ArrayList;
import java.util.List;

/** Filters of {@link EetGatewayClient#listQueue}; all are optional. */
public final class QueueFilter {
  private final List<String> status = new ArrayList<>();
  private String register;
  private Object from;
  private Object to;
  private Boolean overdue;
  private Integer limit;
  private String cursor;

  /** No filter: the newest sales. */
  public static QueueFilter all() {
    return new QueueFilter();
  }

  /** Only sales in these statuses. */
  public QueueFilter status(SaleStatus... statuses) {
    for (SaleStatus s : statuses) status.add(s.value());
    return this;
  }

  /** Only sales in these statuses, as wire values. */
  public QueueFilter status(String... statuses) {
    status.addAll(List.of(statuses));
    return this;
  }

  public QueueFilter register(String value) {
    this.register = value;
    return this;
  }

  /** {@code dat_trzby} from, inclusive: an ISO 8601 string or an {@code OffsetDateTime}/{@code Instant}. */
  public QueueFilter from(Object value) {
    this.from = value;
    return this;
  }

  /** {@code dat_trzby} to, exclusive. */
  public QueueFilter to(Object value) {
    this.to = value;
    return this;
  }

  /** Only sales without POK 48 hours after they happened (true), or only the others (false). */
  public QueueFilter overdue(boolean value) {
    this.overdue = value;
    return this;
  }

  /** Page size, 1 to 500 (default 50). */
  public QueueFilter limit(int value) {
    this.limit = value;
    return this;
  }

  /** The {@link QueuePage#nextCursor()} of the previous page. */
  public QueueFilter cursor(String value) {
    this.cursor = value;
    return this;
  }

  QueueFilter copyWithCursor(String newCursor) {
    QueueFilter copy = new QueueFilter();
    copy.status.addAll(status);
    copy.register = register;
    copy.from = from;
    copy.to = to;
    copy.overdue = overdue;
    copy.limit = limit;
    copy.cursor = newCursor;
    return copy;
  }

  String statusParam() {
    return status.isEmpty() ? null : String.join(",", status);
  }

  String register() {
    return register;
  }

  Object from() {
    return from;
  }

  Object to() {
    return to;
  }

  Boolean overdue() {
    return overdue;
  }

  Integer limit() {
    return limit;
  }

  String cursor() {
    return cursor;
  }
}
