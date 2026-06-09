#!/bin/bash

# Variables
RG="scholarseek-devops-pso"
PLAN="devops-plan"
APP_NAME="scholarseek-app-$RANDOM"
IMAGE="ghcr.io/danielbarz/devops-pso:latest"

# Create a Linux App Service plan
az appservice plan create \
    --name $PLAN \
    --resource-group $RG \
    --sku F1 \
    --is-linux

# Create a Web App for Containers
az webapp create \
    --name $APP_NAME \
    --resource-group $RG \
    --plan $PLAN \
    --deployment-container-image-name $IMAGE

# Configure App Settings
az webapp config appsettings set \
    --name $APP_NAME \
    --resource-group $RG \
    --settings \
    WEBSITES_PORT=3000 \
    DATABASE_URL='postgresql://neondb_owner:npg_PWi5DOT2zFBn@ep-wispy-darkness-aqylzxoe-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require' \
    REDIS_URL='rediss://default:AY8dAAIgcDE0Njk2NGRhMTFjNGE0MDZhYjE5ZTNlMjFiMGE3MGE3MQ@creative-vulture-36637.upstash.io:6379'