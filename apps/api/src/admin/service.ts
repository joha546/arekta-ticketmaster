// Admin business logic — implemented in Phase 09

import { getAllUsers } from "../auth/repository.js";
import { users } from "../db/schema.js";

export const getAllUserService = async () => {

    const AllUsers = await getAllUsers()

    return AllUsers;
};