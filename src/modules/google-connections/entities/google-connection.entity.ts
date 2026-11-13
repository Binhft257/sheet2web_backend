import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('google_connections')
@Unique('uq_google_connections_owner_subject', ['ownerId', 'googleSubject'])
export class GoogleConnection {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner!: User;
  @Column({ name: 'google_subject', type: 'varchar', length: 255 })
  googleSubject!: string;
  @Column({ type: 'varchar', length: 320 }) email!: string;
  @Column({ name: 'encrypted_refresh_token', type: 'text', select: false })
  encryptedRefreshToken!: string;
  @Column({ type: 'text', array: true, default: () => "'{}'::text[]" })
  scopes!: string[];
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
