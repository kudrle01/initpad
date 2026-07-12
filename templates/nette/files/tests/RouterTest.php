<?php

namespace App\Tests;

use App\Router\RouterFactory;
use Nette\Http\Request;
use Nette\Http\UrlScript;
use PHPUnit\Framework\TestCase;

final class RouterTest extends TestCase
{
    public function testHealthRoute(): void
    {
        $match = RouterFactory::createRouter()->match(new Request(new UrlScript('http://localhost/health')));
        self::assertIsArray($match);
        self::assertSame('Home', $match['presenter'] ?? null);
        self::assertSame('health', $match['action'] ?? null);
    }
}
