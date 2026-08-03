<?php

namespace App\Tests;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class HealthTest extends WebTestCase
{
    public function testHealthEndpoint(): void
    {
        $client = static::createClient();
        $client->request('GET', '/health');
        self::assertResponseIsSuccessful();
        self::assertJson($client->getResponse()->getContent());
    }

    public function testProjectFilesAreNotPublic(): void
    {
        $client = static::createClient();

        foreach (['/composer.json', '/.env', '/.env.dist'] as $path) {
            $client->request('GET', $path);
            self::assertResponseStatusCodeSame(404);
        }
    }
}
