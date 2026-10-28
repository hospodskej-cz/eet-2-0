<?php

declare(strict_types=1);

namespace EetGateway\Client\Exception;

/** 401: the API key is missing or wrong. */
final class UnauthorizedException extends ApiException
{
}
