import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Chapter, ChapterDocument } from './schemas/chapter.schema';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { UpdateChapterDto } from './dto/update-chapter.dto';
import { ChapterResponseDto } from './dto/chapter-response.dto';

@Injectable()
export class ChaptersService {
  private readonly logger = new Logger(ChaptersService.name);

  constructor(
    @InjectModel(Chapter.name)
    private chapterModel: Model<ChapterDocument>,
    @InjectModel('StudySet')
    private studySetModel: Model<any>,
  ) {}

  /**
   * Create a new chapter for a user
   */
  async create(
    userId: string,
    createChapterDto: CreateChapterDto,
  ): Promise<ChapterResponseDto> {
    try {
      const chapter = new this.chapterModel({
        userId: new Types.ObjectId(userId),
        name: createChapterDto.name.trim(),
      });

      const saved = await chapter.save();
      return this.toResponseDto(saved);
    } catch (error: any) {
      // Handle duplicate key error (unique index violation)
      if (error.code === 11000) {
        throw new BadRequestException(
          `Chapter with name "${createChapterDto.name}" already exists`,
        );
      }
      throw error;
    }
  }

  /**
   * Get all chapters for a user
   * Sorted by updatedAt desc, then name asc
   */
  async findAll(userId: string): Promise<ChapterResponseDto[]> {
    const chapters = await this.chapterModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ updatedAt: -1, name: 1 })
      .lean()
      .exec();

    return chapters.map((chapter) => this.toResponseDto(chapter));
  }

  /**
   * Get a single chapter by ID (with ownership validation)
   */
  async findOne(chapterId: string, userId: string): Promise<ChapterDocument> {
    const chapter = await this.chapterModel
      .findOne({
        _id: new Types.ObjectId(chapterId),
        userId: new Types.ObjectId(userId),
      })
      .exec();

    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    return chapter;
  }

  /**
   * Update (rename) a chapter
   */
  async update(
    chapterId: string,
    userId: string,
    updateChapterDto: UpdateChapterDto,
  ): Promise<ChapterResponseDto> {
    // Verify ownership
    await this.findOne(chapterId, userId);

    try {
      const updated = await this.chapterModel
        .findOneAndUpdate(
          {
            _id: new Types.ObjectId(chapterId),
            userId: new Types.ObjectId(userId),
          },
          {
            $set: {
              name: updateChapterDto.name.trim(),
            },
          },
          { new: true },
        )
        .exec();

      if (!updated) {
        throw new NotFoundException('Chapter not found');
      }

      return this.toResponseDto(updated);
    } catch (error: any) {
      // Handle duplicate key error
      if (error.code === 11000) {
        throw new BadRequestException(
          `Chapter with name "${updateChapterDto.name}" already exists`,
        );
      }
      throw error;
    }
  }

  /**
   * Delete a chapter
   * Unassigns all study sets from this chapter (sets chapterId to null)
   */
  async remove(chapterId: string, userId: string): Promise<void> {
    // Verify ownership
    await this.findOne(chapterId, userId);

    const chapterObjectId = new Types.ObjectId(chapterId);
    const userObjectId = new Types.ObjectId(userId);

    try {
      // Step 1: Unassign all study sets from this chapter
      const updateResult = await this.studySetModel
        .updateMany(
          {
            userId: userObjectId,
            chapterId: chapterObjectId,
          },
          {
            $set: { chapterId: null },
          },
        )
        .exec();

      this.logger.log(
        `Unassigned ${updateResult.modifiedCount} study sets from chapter ${chapterId}`,
      );

      // Step 2: Delete the chapter
      const deleteResult = await this.chapterModel
        .deleteOne({
          _id: chapterObjectId,
          userId: userObjectId,
        })
        .exec();

      if (deleteResult.deletedCount === 0) {
        throw new NotFoundException('Chapter not found');
      }

      this.logger.log(`Deleted chapter ${chapterId}`);
    } catch (error: any) {
      this.logger.error(
        `Failed to delete chapter ${chapterId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Validate that a chapter belongs to a user
   */
  async validateChapterOwnership(
    chapterId: string | null,
    userId: string,
  ): Promise<boolean> {
    if (!chapterId) return true; // null is always valid (no chapter)

    try {
      await this.findOne(chapterId, userId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Convert Chapter document to response DTO
   */
  private toResponseDto(chapter: any): ChapterResponseDto {
    return {
      id: chapter._id.toString(),
      name: chapter.name,
      createdAt: chapter.createdAt,
      updatedAt: chapter.updatedAt,
    };
  }
}
