<?php

declare(strict_types=1);

namespace EetGateway\Client\Exception;

/** 409: the record is final (`not_retryable`), being sent (`in_progress`) or its register is gone. */
class ConflictException extends ApiException
{
}
