-- MySQL dump 10.13  Distrib 8.0.45, for Win64 (x86_64)
--
-- Host: localhost    Database: hospital_inventory
-- ------------------------------------------------------
-- Server version	8.0.45

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `full_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `avatar_path` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('admin','employee','customer') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'employee',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'admin','admin@local.hms','System Admin',NULL,'$2b$12$uMykbtL.kIocujarSNNkLOd7DQpjVrl5GMoOz9EIYF.bRbefdwiTu','admin',1,'2026-03-03 05:39:26','2026-03-05 07:09:07'),(2,'USER','user@local.com','Staff',NULL,'$2b$12$59ZG8Y/WsB7iGpn6wENZ5up1g8KeXjHEWC6ibcQBFXASHdVT.qCyq','employee',1,'2026-03-03 05:39:26','2026-03-13 07:23:50'),(7,'Jay','jersen.creus@gmail.com','Jersen Jay Creus','uploads/avatars/avatar-7-1773388158201-592765943.jpg','$2b$12$JOQOEM40sLNmZXZygcAIkebstZIkVAEyhi1DRzAbyPiraFIlow20i','employee',1,'2026-03-03 06:51:23','2026-03-13 07:49:18'),(8,'Kentoy','ken.martinez@gmail.com','Ken Martinez',NULL,'$2b$12$mLXgkEvtoxqHdEFMGZoQwOwGr853s3I5M6.MLDZtMiYsRMVAMekxu','employee',1,'2026-03-03 07:28:17','2026-03-03 07:28:17'),(9,'Garcia','gar.cia@gmail.com','STAFF',NULL,'$2b$12$7LC0xL2FkXng.C2NXPNSJeGs6g7SmfI4taG2jPZMYMBBoyV4JgpXe','employee',1,'2026-03-03 08:24:11','2026-03-03 08:24:11'),(10,'Admin1','admin@admin.com','Admin1',NULL,'$2b$12$fQchTAEZ1uyoRG6NsX0F1OyaSKHXEUxBENlsq8aHzhlP1Ha0GuoHS','admin',1,'2026-03-03 08:45:09','2026-03-03 08:45:40'),(19,'Sophia','staff@gmail.com','Staff',NULL,'$2b$12$wbMAtCtfyIE150TNw1ZjeuTc237P5FlkGrWBq7M0rJFYpRZE0JvoC','employee',1,'2026-03-04 06:59:49','2026-03-04 06:59:49'),(22,'miguel123','miguel.alcala@gmail.com','Staff Miguel',NULL,'$2b$12$Hhjt8nliJM7oRf6iEf6UROuNgVkFrnP4Wx4bERX6iH8UvmBx/pqZm','employee',1,'2026-03-13 06:20:26','2026-03-13 06:20:26');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-03-19  7:19:34
