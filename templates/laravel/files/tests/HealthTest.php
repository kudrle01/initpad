<?php

namespace Tests;

final class HealthTest extends TestCase
{
    public function testHealthEndpoint(): void
    {
        $this->get('/health')->assertOk()->assertJson(['status' => 'ok']);
        $this->get('/')->assertOk()->assertJson(['status' => 'ok']);
    }

    public function testProjectFilesAreNotPublic(): void
    {
        foreach (['/composer.json', '/.env'] as $path) {
            $this->get($path)->assertNotFound();
        }
    }
}
