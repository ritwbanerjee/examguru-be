import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { SummariesModule } from './summaries/summaries.module';
import { StudySetsModule } from './study-sets/study-sets.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    MongooseModule.forRoot(process.env.MONGODB_URI || 'mongodb://localhost:27017/examguru'),
    UsersModule,
    AuthModule,
    SummariesModule,
    StudySetsModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
